var Target = require("montage/core/target").Target,
    Promise = require('montage/core/promise').Promise,
    RTCPeerConnection = webkitRTCPeerConnection;

var RTCService = Target.specialize({
    _isPeerToPeer: {
        value: null
    },

    _peerToPeerClients: {
        value: null
    },

    _clients: {
        value: null
    },

    _channels: {
        value: null
    },

    _peers: {
        value: null
    },

    constructor: {
        value: function() {
            this._isPeerToPeer = false;
            this._peerToPeerClients = [];
            this._clients = {};
            this._channels = {};
            this._peers = {};
        }
    },

    init: {
        value: function(id, isServer) {
            this.id = id;
            this._isServer = !!isServer;
            return this;
        }
    },

    setRoomId: {
        value: function(id) {
            this._roomId = id;
        }
    },

    sendOffer: {
        value: function(id, target) {
            var self = this;
            id = id || this._roomId;
            this._roomId = id;

            var peerConnection = this._createPeerConnection(target);
            self._createDataChannel(target);

            peerConnection.onicecandidate = function(event) {
                self._handleIceCandidate(event);
            };

            return new Promise.Promise(function(resolve) {
                peerConnection.createOffer(function(offer) {
                    peerConnection.setLocalDescription(offer, function() {
                        var message = {
                            source: self.id,
                            type: 'webrtc',
                            cmd: 'sendOffer',
                            data: {
                                targetRoom: id,
                                offer: peerConnection.localDescription
                            }
                        };
                        self._sendSignaling(message, target);
                        self.addEventListener('ready', function() {
                            resolve();
                        });
                    });
                });
            });
        }
    },

    getAnswer: {
        value: function(message) {
            var self = this;
            return new Promise.Promise(function(resolve, reject) {
                    var peerConnection = self._getMatchingPeerConnection(message);
                    if (peerConnection) {
                        if (peerConnection.remoteDescription.type === 'offer') {
                            peerConnection.createAnswer(function(answer) {
                                resolve(answer);
                            });
                        }
                    } else {
                        reject('No such client:', message.source);
                    }
                })
                .then(function(answer) {
                    return self._setLocalDescription(message, answer);
                });
        }
    },

    handleSignalingMessage: {
        value: function(message) {
            var self = this;
            if (message.data && message.data.offer) {
                this._createPeerConnection(message.source);
                return this._setRemoteDescription(message)
                    .then(function () {
                        return self.getAnswer(message)
                    })
                    .then(function (answer) {
                        self._sendSignaling({
                            source: self.id,
                            type: 'webrtc',
                            cmd: 'sendAnswer',
                            data: {
                                targetRoom: message.data.targetRoom,
                                targetClient: message.source,
                                answer: answer
                            }
                        }, message.source);
                    });
            } else if (message.data && message.data.answer) {
                return self._setRemoteDescription(message);
            } else if (message.data && message.data.candidate) {
                this._addIceCandidate(message);
            } else if (!message.hasOwnProperty('success')) {
                return Promise.reject();
            }
        }
    },

    send: {
        value: function(message, target, excludes) {
            excludes = excludes || [];
            if (target != this.id && excludes.indexOf(target) == -1) {
                try {
                    message.source = message.source || this.id;
                    message.target = message.target || target;
                    var payload = JSON.stringify(message);
                    if (this._dataChannel) {
                        if (this._dataChannel.readyState == 'open' && (this._peerConnection.iceConnectionState == 'connected' || this._peerConnection.iceConnectionState == 'completed')) {
                            this._dataChannel.send(payload);
                        }
                    } else {
                        if (!!target) {
                            this._channels[target].send(payload)
                        } else {
                            for (var channelId in this._channels) {
                                if (this._channels.hasOwnProperty(channelId)) {
                                    if (excludes.indexOf(channelId) == -1) {
                                        if (this._channels[channelId].readyState == 'open' && (this._clients[channelId].iceConnectionState == 'connected' || this._clients[channelId].iceConnectionState == 'completed')) {
                                            this._channels[channelId].send(payload);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.trace('Cannot send message:', message, target, err);
                }
            }
        }
    },

    disconnect: {
        value: function(target) {
            var self = this;
            return new Promise.Promise(function(resolve) {
                var message = {
                    type: 'close'
                };
                self.send(message, target);
                resolve();
            });
        }
    },

    quit: {
        value: function(target) {
            var self = this;
            this._isPeerToPeer = false;
            return new Promise.Promise(function(resolve) {
                    var message = {
                        type: 'quit'
                    };
                    self.send(message, target);
                    resolve();
                })
                .then(function() {
                    if (self._dataChannel) {
                        self._dataChannel.close();
                        delete self._dataChannel;
                    } else {
                        for (var channelId in self._channels) {
                            if (self._channels.hasOwnProperty(channelId)) {
                                self._channels[channelId].close();
                                self._channels[channelId] = null;
                                delete self._channels[channelId];
                            }
                        }
                    }
                    if (self._peerConnection) {
                        self._peerConnection.close();
                        self._peerConnection = null;
                    } else {
                        for (var clientId in self._clients) {
                            if (self._clients.hasOwnProperty(clientId)) {
                                self._clients[clientId].close();
                                self._clients[clientId] = null;
                                delete self._clients[clientId];
                            }
                        }
                    }
                });
        }
    },

    removeClient: {
        value: function(id) {
            var self = this;
            return new Promise.Promise(function(resolve) {
                    if (self._clients[id]) {
                        if (self._clients[id].iceConnectionState != 'closed') {
                            self._clients[id].close();
                        }
                        if (self._channels[id].readyState != 'closed') {
                            self._channels[id].close();
                        }
                    }
                    resolve();
                })
                .then(function() {
                    delete self._clients[id];
                    delete self._channels[id];
                });
        }
    },

    enterPeerToPeerMode: {
        value: function() {
            if (!this._isPeerToPeer) {
                var message = {
                    type: 'P2P'
                };
                this.send(message);
                this._isPeerToPeer = true;
            }
        }
    },

    attachStream: {
        value: function(stream, target) {
            var peerConnection = this._getMatchingPeerConnection(target);
            if (peerConnection) {
                peerConnection.addStream(stream);
            } else {
                if (target) {
                    this._clients[target].addStream(stream);
                } else {
                    for (var clientId in this._clients) {
                        if (this._clients.hasOwnProperty(clientId)) {
                            this._clients[clientId].addStream(stream);
                        }
                    }
                }
            }
        }
    },

    detachStream: {
        value: function(stream, target) {
            var peerConnection = this._getMatchingPeerConnection(target);
            if (peerConnection && ['completed', 'connected'].indexOf(peerConnection.iceConnectionState) != -1) {
                peerConnection.removeStream(stream);
            } else {
                for (var clientId in this._clients) {
                    if (this._clients.hasOwnProperty(clientId)  && ['completed', 'connected'].indexOf(this._clients[clientId].iceConnectionState) != -1) {
                        this._clients[clientId].removeStream(stream);
                    }
                }
            }
        }
    },

    detachLocalStreams: {
        value: function(target) {
            var streams,
                peerConnection = this._getMatchingPeerConnection(target);
            if (peerConnection && ['completed', 'connected'].indexOf(peerConnection.iceConnectionState) != -1) {
                streams = peerConnection.getLocalStreams();
                for (var i = 0, streamsLength = streams.length; i < streamsLength; i++) {
                    peerConnection.removeStream(streams[i]);
                }
            } else {
                for (var clientId in this._clients) {
                    if (this._clients.hasOwnProperty(clientId)  && ['completed', 'connected'].indexOf(this._clients[clientId].iceConnectionState) != -1) {
                        peerConnection = this._clients[clientId];
                        streams = peerConnection.getLocalStreams();
                        for (var i = 0, streamsLength = streams.length; i < streamsLength; i++) {
                            peerConnection.removeStream(streams[i]);
                        }
                    }
                }
            }
        }
    },

    _getMatchingPeerConnection: {
        value: function(target) {
            if (typeof target === 'object') {
                target = target.source;
            }
            var peerConnection = this._peerConnection;
            if (!peerConnection) {
                peerConnection = this._clients[target];
            }
            return peerConnection;
        }
    },

    _getMatchingDataChannel: {
        value: function(target) {
            if (typeof target === 'object') {
                target = target.source;
            }
            var dataChannel = this._dataChannel;
            if (!dataChannel) {
                dataChannel = this._channels[target];
            }
            return dataChannel;
        }
    },

    _addIceCandidate: {
        value: function(message) {
            var peerConnection = this._getMatchingPeerConnection(message);
            if (peerConnection) {
                var iceCandidate = new RTCIceCandidate(message.data.candidate);
                try {
                    peerConnection.addIceCandidate(iceCandidate);
                } catch (err) {
                    console.trace('Error trying to add iceCandidate:', iceCandidate, peerConnection, err);
                }
            }
        }
    },

    _createPeerConnection: {
        value: function(remoteId) {
            var self = this;
            var isConnectionCreated = this._isServer ? (!remoteId || !!this._clients[remoteId]) : !!this._peerConnection;
            if (!isConnectionCreated) {
                var peerConnection = new RTCPeerConnection(null);
                //var peerConnection = new RTCPeerConnection({ iceServers: [] });

                peerConnection.onicecandidate = function(event) {
                    self._handleIceCandidate(event, remoteId);
                };

                peerConnection.remoteId = remoteId;
                peerConnection.oniceconnectionstatechange = function(event) {
                    var eventName = 'close' + (!!remoteId ? '_' + remoteId : '');
                    if (['closed', 'failed'].indexOf(peerConnection.iceConnectionState) != -1) {
                        self.dispatchEventNamed(eventName);
                    }
                    if (peerConnection.iceConnectionState === 'disconnected') {
                        setTimeout(function() {
                            if (['closed', 'disconnected', 'failed'].indexOf(peerConnection.iceConnectionState) != -1) {
                                self.dispatchEventNamed(eventName);
                            }
                        }, 2000)
                    }
                };

                peerConnection.onnegotiationneeded = function(event) {
                    self.sendOffer(null, remoteId);
                };

                peerConnection.onaddstream = function(event) {
                    event.remoteId = remoteId;
                    self.dispatchEvent(event);
                };
                peerConnection.onremovestream = function(event) {
                    event.remoteId = remoteId;
                    self.dispatchEvent(event);
                };
                var closeListener;
                if (!!remoteId) {
                    peerConnection.ondatachannel = function(event) {
                        self._channels[remoteId] = event.channel;
                        self._initializeDataChannel(self._channels[remoteId]);
                    };
                    this._clients[remoteId] = peerConnection;

                    closeListener = function () {
                        if (self._channels[remoteId]) {
                            self._channels[remoteId].close();
                        }
                        delete self._channels[remoteId];
                        delete self._clients[remoteId];
                        var p2pIndex = self._peerToPeerClients.indexOf(remoteId);
                        if (p2pIndex != -1) {
                            self._peerToPeerClients.splice(p2pIndex, 1);
                        }
                        var quitEvent = new CustomEvent('message');
                        quitEvent.data = JSON.stringify({
                            type: 'quit',
                            source: remoteId
                        });
                        self.dispatchEvent(quitEvent);
                        self.removeEventListener('close_' + remoteId, closeListener);
                    };
                    this.addEventListener('close_' + remoteId, closeListener);
                } else {
                    this._peerConnection = peerConnection;

                    closeListener = function () {
                        if (self._dataChannel) {
                            self._dataChannel.close();
                        }
                        delete self._dataChannel;
                        delete self._peerConnection;
                        self._isPeerToPeer = false;
                        var quitEvent = new CustomEvent('message');
                        quitEvent.data = JSON.stringify({
                            type: 'close'
                        });
                        self.dispatchEvent(quitEvent);
                        self.removeEventListener('close_' + remoteId, closeListener);
                    };
                    this.addEventListener('close_' + remoteId, closeListener);
                }
            }
            return this._getMatchingPeerConnection(remoteId);
        }
    },

    _initializeDataChannel: {
        value: function (dataChannel) {
            var self = this;
            dataChannel.onopen = function (event) {
                self.dispatchEventNamed('ready');
            };

            dataChannel.onerror = function (event) {
                console.log('DataChannel error:', event);
            };

            dataChannel.onmessage = function (event) {
                var message = JSON.parse(event.data);
                switch (message.type) {
                    case 'webrtc':
                        if (!message.target || message.target.split('P')[0] === self.id) {
                            if (!message.target || message.target.indexOf('P') == -1) {
                                self.handleSignalingMessage(message);
                            } else {
                                self.dispatchEventNamed('p2pSignalingMessage', true, true, message);
                            }
                        } else {
                            self.send(message, message.target.split('P')[0]);
                        }
                        break;
                    case 'P2P':
                        self._peerToPeerClients.push(message.source);
                        break;
                    default:
                        self.dispatchEvent(event);
                        break;
                }
            };
        }
    },

    _createDataChannel: {
        value: function(target) {
            if (!this._getMatchingDataChannel(target)) {
                var peerConnection = this._getMatchingPeerConnection(target);
                var dataChannel = peerConnection.createDataChannel('message-' + this.id, { protocol: 'tcp' });
                this._initializeDataChannel(dataChannel);
                if (this._peerConnection) {
                    this._dataChannel = dataChannel;
                } else {
                    this._channels[target] = dataChannel;
                }
            }
        }
    },

    _setLocalDescription: {
        value: function(message, description) {
            var self = this;
            return new Promise.Promise(function(resolve, reject) {
                var peerConnection = self._getMatchingPeerConnection(message);
                if (peerConnection) {
                    if (peerConnection.localDescription && peerConnection.localDescription.type && peerConnection.localDescription.type !== '') {
                        resolve(peerConnection.localDescription);
                    } else {
                        peerConnection.setLocalDescription(description, function () {
                            resolve(peerConnection.localDescription);
                        }, function (err) {
                            var pc = self._getMatchingPeerConnection(message);
                            console.log(err, pc.iceConnectionState, pc.iceGatheringState, pc.signalingState);
                        });
                    }
                } else {
                    reject('No such client:', message.source);
                }
            });
        }
    },

    _setRemoteDescription: {
        value: function(message) {
            var self = this;
            return new Promise.Promise(function(resolve, reject) {
                var peerConnection = self._getMatchingPeerConnection(message);
                if (peerConnection) {
                    if (peerConnection.remoteDescription && peerConnection.remoteDescription.type && peerConnection.remoteDescription.type !== '') {
                        resolve(peerConnection.remoteDescription);
                    } else {
                        var description = message.data.offer || message.data.answer;
                        peerConnection.setRemoteDescription(new RTCSessionDescription(description), function() {
                            resolve();
                        }, function(err) {
                            var pc = self._getMatchingPeerConnection(message);
                            console.log(err, pc.iceConnectionState, pc.iceGatheringState, pc.signalingState);
                        });
                    }
                } else {
                    reject('No such client:', message.source);
                }
            });
        }
    },

    _handleIceCandidate: {
        value: function(event, target) {
            if (event.candidate) {
                var message = {
                    source: this.id,
                    type: 'webrtc',
                    cmd: 'sendCandidate',
                    data: {
                        targetRoom: this._roomId,
                        candidate: event.candidate
                    }
                };
                if (target) {
                    message.data.targetClient = target;
                }
                this._sendSignaling(message);
            }
        }
    },

    _sendSignaling: {
        value: function(message, target) {
            if (this._isPeerToPeer || this._peerToPeerClients.indexOf(target) != -1) {
                this.send(message, target);
            } else {
                this.dispatchEventNamed('signalingMessage', true, true, message);
            }
        }
    }
});

exports.RTCService = RTCService;
