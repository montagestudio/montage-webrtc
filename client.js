var Target = require("montage/core/target").Target,
    Promise = require('montage/core/promise').Promise,
    Uuid = require('montage/core/uuid'),
    RTCPeerConnection = webkitRTCPeerConnection,
    ROLE_SIGNALING = 'signaling',
    ROLE_DATA = 'data',
    ROLE_MEDIA = 'media',
    CONNECTION_STATES = {
        descriptionCreated:     1,
        localDescriptionSet:    2,
        descriptionSent:        4,
        remoteDescriptionSet:   8,
        candidatesSent:         16,
        candidatesReceived:     32
    },
    CONNECTION_READY_TO_EXCHANGE_CANDIDATES =    15;

var RTCService = Target.specialize({
    id:                        { value: null },
    _roomId:                    { value: null },
    _stunServers:               { value: null },
    _targetClient:              { value: null },
    _peerConnections:           { value: null },
    _dataChannels:              { value: null },
    _localIceCandidates:        { value: null },
    _remoteIceCandidates:       { value: null },
    _isP2P:                     { value: null },
    _streamToAddEvent:          { value: null },
    _localDescriptionVersion:   { value: null },
    _remoteDescriptionVersion:  { value: null },

    constructor: {
        value: function() {
            this._isP2P = false;
            this._peerConnections = {};
            this._dataChannels = {};
            this._localIceCandidates = {};
            this._localIceCandidates[ROLE_SIGNALING] = [];
            this._localIceCandidates[ROLE_DATA] = [];
            this._localIceCandidates[ROLE_MEDIA] = [];
            this._remoteIceCandidates = {};
            this._remoteIceCandidates[ROLE_SIGNALING] = [];
            this._remoteIceCandidates[ROLE_DATA] = [];
            this._remoteIceCandidates[ROLE_MEDIA] = [];

        }
    },

    init: {
        value: function(id, stunServers) {
            this.id = id;
            this._stunServers = stunServers || null;
            return this;
        }
    },

    connect: {
        value: function(roomId) {
            var self = this;
            this._roomId = roomId || this._roomId;
            this._peerConnections[ROLE_SIGNALING] = this._createPeerConnection(ROLE_SIGNALING, true);
            this._peerConnections[ROLE_DATA]      = this._createPeerConnection(ROLE_DATA, true);
            return this._sendOffer(this._peerConnections[ROLE_SIGNALING])
                .then(function() {
                    return self._sendOffer(self._peerConnections[ROLE_DATA])
                })
                .then(function() {
                    return self._switchToP2P();
                });
        }
    },

    connectToPeer: {
        value: function(peerId) {
            this._targetClient = peerId || this._targetClient;
            this._peerConnections[ROLE_DATA]      = this._createPeerConnection(ROLE_DATA, true);
            return this._sendOffer(this._peerConnections[ROLE_DATA])
                .then(function() {
                    return peerId;
                });
        }
    },

    setRoomId: {
        value: function(roomId) {
            this._roomId = roomId;
        }
    },

    handleSignalingMessage: {
        value: function(message) {
            switch (message.type) {
                case 'webrtc':
                    return this._handleWebrtcMessage(message);
                    break;
                case 'mode':
                    return this._handleModeMessage(message);
                    break;
                default:
                    console.log('Unknown message type:', message.type, message);
                    return Promise.reject();
                    break;
            }
        }
    },

    send: {
        value: function(message) {
            message.source = message.source || this.id;
            this._dataChannels[ROLE_DATA].send(JSON.stringify(message));
        }
    },

    quit: {
        value: function(sendMessage) {
            var self = this;
            return new Promise.Promise(function(resolve) {
                if (sendMessage) {
                    self.send({ type: 'quit' });
                }

                self._closeConnectionWithRole(ROLE_DATA);
                self._closeConnectionWithRole(ROLE_SIGNALING);
                resolve();
            });
        }
    },

    attachStream: {
        value: function(stream) {
            var self = this;
            return new Promise.Promise(function(resolve, reject) {
                try {
                    self._peerConnections[ROLE_MEDIA] = self._createPeerConnection(ROLE_MEDIA);
                    self._peerConnections[ROLE_MEDIA].addStream(stream);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
        }
    },

    detachStream: {
        value: function() {
            if (this._peerConnections[ROLE_MEDIA]) {
                this._peerConnections[ROLE_MEDIA].close();
                delete this._peerConnections[ROLE_MEDIA];
            }
        }
    },

    _handleModeMessage: {
        value: function(message) {
            switch (message.cmd) {
                case 'p2p':
                    this._switchToP2P();
                    return Promise.resolve();
                    break;
                default:
                    console.log('Unknown mode message cmd:', message.cmd, message);
            }
        }
    },

    _handleWebrtcMessage: {
        value: function(message) {
            var data = message.data,
                role = data.role;
            switch (message.cmd) {
                case 'offer':
                    this._targetClient = message.source;
                    this._peerConnections[role] = this._createPeerConnection(role);
                    this._peerConnections[role].descriptionVersion = data.descriptionVersion;
                    this._peerConnections[role].remoteState = data.state;
                    return this._receiveOffer(this._peerConnections[role], data.description);
                    break;
                case 'answer':
                    if (data.descriptionVersion === this._peerConnections[role].descriptionVersion) {
                        this._targetClient = message.source;
                        return this._receiveAnswer(this._peerConnections[role], data.description);
                    } else {
                        return Promise.resolve();
                    }
                    break;
                case 'candidates':
                    this._receiveIceCandidates(this._peerConnections[role], data.candidates);
                    break;
                default:
                    console.log('Unknown webrtc message cmd:', message.cmd, message);
                    break;
            }
        }
    },

    _closeConnectionWithRole: {
        value: function(role) {
            try {
                this._dataChannels[role].close();
            }catch (err) {
            } finally {
                delete this._dataChannels[role];
            }
            try {
                this._peerConnections[role].close();
            }catch (err) {
            } finally {
                delete this._peerConnections[role];
            }
        }
    },

    _createPeerConnection: {
        value: function(role) {
            var self = this,
                peerConnection = new RTCPeerConnection(this._stunServers, null);
            peerConnection.role = role;
            peerConnection.state = 0;

            peerConnection.onicecandidate = function(event) {
                self._handleLocalIceCandidate(peerConnection, event.candidate);
            };

            peerConnection.onaddstream = function(event) {
                event.remoteId = self._targetClient;
                self.dispatchEvent(event);
            };

            peerConnection.oniceconnectionstatechange = function() {
                if (peerConnection.iceConnectionState === 'completed' ||
                    peerConnection.iceConnectionState === 'connected') {

                }
            };

            peerConnection.onnegotiationneeded = function() {
                if (peerConnection.state === CONNECTION_READY_TO_EXCHANGE_CANDIDATES) {
                    peerConnection.isRenegociating = true;
                }
                self._sendOffer(peerConnection);
            };

            peerConnection.ondatachannel = function(event) {
                self._initializeDataChannel(peerConnection, event.channel);
            };

            return peerConnection;
        }
    },

    _sendDescription: {
        value: function (peerConnection, descriptionType, description) {
            var message = {
                source: this.id,
                type: 'webrtc',
                cmd: descriptionType,
                data: {
                    targetRoom: this._roomId,
                    role: peerConnection.role,
                    state: peerConnection.state,
                    descriptionVersion: peerConnection.descriptionVersion,
                    description: description
                }
            };
            if (this._targetClient) {
                message.data.targetClient = this._targetClient;
            }
            this._sendSignaling(message);
            peerConnection.state += CONNECTION_STATES.descriptionSent;
        }
    },

    _sendOffer: {
        value: function(peerConnection) {
            var self = this,
                descriptionVersion;
            peerConnection.state = 0;
            return this._createOffer(peerConnection)
                .then(function(offer) {
                    descriptionVersion = Uuid.generate();
                    return self._setLocalDescription(peerConnection, offer);
                })
                .then(function(offer) {
                    return new Promise.Promise(function(resolve) {
                        peerConnection.descriptionVersion = descriptionVersion;
                        self._sendDescription(peerConnection, 'offer', offer);
                        self.addEventListener('ready', function() {
                            resolve();
                        });
                    });
                });
        }
    },

    _createOffer: {
        value: function(peerConnection) {
            return new Promise.Promise(function(resolve, reject) {
                peerConnection.createOffer(function(offer) {
                    peerConnection.state += CONNECTION_STATES.descriptionCreated;
                    resolve(offer);
                }, function(err) {
                    reject(err);
                });
            });
        }
    },

    _setLocalDescription: {
        value: function(peerConnection, description) {
            var self = this;
            return new Promise.Promise(function(resolve, reject) {
                peerConnection.setLocalDescription(description, function() {
                    peerConnection.state += CONNECTION_STATES.localDescriptionSet;
                    if (self._remoteIceCandidates[peerConnection.role] &&
                        self._remoteIceCandidates[peerConnection.role].length > 0) {
                        self._receiveIceCandidates(peerConnection, self._remoteIceCandidates[peerConnection.role]);
                    }
                    resolve(peerConnection.localDescription);
                }, function(err) {
                    reject(err);
                });
            });
        }
    },

    _sendSignaling: {
        value: function(message) {
            if (this._isP2P) {
                this._dataChannels[ROLE_SIGNALING].send(JSON.stringify(message));
            } else {
                this.dispatchEventNamed('signalingMessage', true, true, message);
            }
        }
    },

    _receiveOffer: {
        value: function(peerConnection, offer, descriptionVersion) {
            var self = this;
            peerConnection.state = 0;
            this._remoteIceCandidates[peerConnection.role] = [];
            return this._setRemoteDescription(peerConnection, offer)
                .then(function() {
                    return self._createAnswer(peerConnection);
                })
                .then(function(answer) {
                    return self._setLocalDescription(peerConnection, answer);
                })
                .then(function(answer) {
                    return self._sendDescription(peerConnection, 'answer', answer, descriptionVersion);
                });
        }
    },

    _setRemoteDescription: {
        value: function(peerConnection, description) {
            var self = this;
            return new Promise.Promise(function(resolve, reject) {
                peerConnection.setRemoteDescription(new RTCSessionDescription(description), function() {
                    peerConnection.state += CONNECTION_STATES.remoteDescriptionSet;
                    if (self._remoteIceCandidates[peerConnection.role] &&
                        self._remoteIceCandidates[peerConnection.role].length > 0) {
                        self._receiveIceCandidates(peerConnection, self._remoteIceCandidates[peerConnection.role]);
                    }
                    resolve(peerConnection.remoteDescription);
                }, function(err) {
                    reject(err);
                });
            });
        }
    },

    _createAnswer: {
        value: function(peerConnection) {
            return new Promise.Promise(function(resolve, reject) {
                peerConnection.createAnswer(function(answer) {
                    peerConnection.state += CONNECTION_STATES.descriptionCreated;
                    resolve(answer);
                }, function(err) {
                    reject(err);
                });
            });
        }
    },

    _receiveAnswer: {
        value: function(peerConnection, answer) {
            var self = this;
            if (this._localDescriptionVersion !== this._remoteDescriptionVersion) {
                return Promise.resolve();
            } else {
                return this._setRemoteDescription(peerConnection, answer)
                    .then(function() {
                        if (peerConnection.role !== ROLE_MEDIA) {
                            self._createDataChannel(peerConnection);
                        }
                    });
            }
        }
    },

    _handleLocalIceCandidate: {
        value: function(peerConnection, candidate) {
            if (candidate) {
                this._localIceCandidates[peerConnection.role].push(candidate);
            } else {
                this._sendCandidates(peerConnection);
            }
        }
    },

    _sendCandidates: {
        value: function(peerConnection) {
            var message = {
                source: this.id,
                type: 'webrtc',
                cmd: 'candidates',
                data: {
                    targetRoom: this._roomId,
                    role: peerConnection.role,
                    state: peerConnection.state,
                    candidates: this._localIceCandidates[peerConnection.role]
                }
            };
            if (this._targetClient) {
                message.data.targetClient = this._targetClient;
            }
            this._sendSignaling(message);
        }
    },

    _receiveIceCandidates: {
        value: function(peerConnection, candidates) {
            if (peerConnection.state % CONNECTION_READY_TO_EXCHANGE_CANDIDATES === 0) {
                for (var i = 0, candidatesLength = candidates.length; i < candidatesLength; i++) {
                    peerConnection.addIceCandidate(new RTCIceCandidate(candidates[i]));
                }
            } else {
                this._remoteIceCandidates[peerConnection.role] = candidates;
            }
        }
    },

    _initializeDataChannel: {
        value: function (peerConnection, dataChannel) {
            var self = this;

            dataChannel.onopen = function () {
                self.dispatchEventNamed('ready', true, true, { role: peerConnection.role });
                if (peerConnection.role === ROLE_DATA) {
                    var pingRemote = function() {
                        if (!dataChannel.isWaitingForPong) {
                            try {
                                dataChannel.send('{ "type": "ping"}');
                                dataChannel.isWaitingForPong = true;
                                setTimeout(pingRemote, 5000);
                            } catch (err) {
                                console.log('Unable to ping:', self._targetClient, err, dataChannel.readyState);
                            }
                        } else {
                            console.log('Pong timeout');
                            try {
                                dataChannel.close();
                                peerConnection.close();
                            } catch (err) {}
                        }
                    };
                    setTimeout(pingRemote, 5000)
                }
            };

            dataChannel.onclose = function(event) {
                self.dispatchEventNamed('connectionClose', true, true, self._targetClient);
            };

            dataChannel.onerror = function (event) {
                console.log('DataChannel error:', event);
            };

            if (peerConnection.role === ROLE_DATA) {
                dataChannel.onmessage = function (event) {
                    var message = JSON.parse(event.data);
                    switch (message.type) {
                        case 'webrtc':
                            if (self._isP2P && self._removePeerId(message.data.targetClient) !== self.id) {
                                self.dispatchEventNamed('forwardMessage', true, true, message);
                            } else {
                                self.dispatchEventNamed('signalingMessage', true, true, message);
                            }
                            break;
                        case 'ping':
                            dataChannel.send('{ "type": "pong" }');
                            break;
                        case 'pong':
                            dataChannel.isWaitingForPong = false;
                            break;
                        default:
                            self.dispatchEvent(event);
                            break;
                    }
                };
            } else {
                dataChannel.onmessage = function(event) {
                    self.handleSignalingMessage(JSON.parse(event.data));
                }
            }

            this._dataChannels[peerConnection.role] = dataChannel;
        }
    },

    _createDataChannel: {
        value: function(peerConnection) {
            this._initializeDataChannel(peerConnection, peerConnection.createDataChannel(this._targetClient + '_' + peerConnection.role));
        }
    },

    _switchToP2P: {
        value: function() {
            if (!this._isP2P) {
                this._isP2P = true;
                this._sendSignaling({
                    type: 'mode',
                    cmd: 'p2p'
                });
            }
            this.dispatchEventNamed('switchToP2P');
        }
    },

    _removePeerId: {
        value: function(clientId) {
            return clientId.split('P')[0];
        }
    }
});

exports.RTCService = RTCService;
