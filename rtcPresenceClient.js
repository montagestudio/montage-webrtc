var Target = require("montage/core/target").Target,
    Promise = require('montage/core/promise').Promise,
    RTCService = require('./client').RTCService;

exports.RtcPPresenceClient = Target.specialize({
    _isReady: { value: false },
    _signalingService: { value: null },
    _peers: { value: {} },
    _topology: { value: null },
    _readyPeers: { value: [] },
    _streamTarget: { value: [] },

    init: {
        value: function(signalingRtcService) {
            var self = this;
            this.id = signalingRtcService.id + 'P' + Math.round(Math.random() * 1000000);
            this._signalingService = signalingRtcService;
            this._signalingService.addEventListener('signalingMessage', function(event) {
                var message = event.detail;
                var peer = self._peers[message.source];
                if (!peer) {
                    peer = self._createPeer(message.source);
                    peer.addEventListener('ready', function() {
                        self._readyPeers.push(message.source);
                        if (!self._isReady && self._topology) {
                            var nonReadyPeers = self._topology.filter(function(x) { return x != self.id && self._readyPeers.indexOf(x) == -1; });
                            if (nonReadyPeers.length === 0) {
                                self.dispatchEventNamed('ready');
                                self._isReady = true;
                            }
                        }
                    });
                }
                peer.handleSignalingMessage(message);
            });
            return this;
        }
    },

    _createPeer: {
        value: function (remoteId) {
            var self = this,
                peer = new RTCService().init(this.id);
            peer.addEventListener('signalingMessage', function (event) {
                self._signalingService.send(event.detail);
            });
            peer.addEventListener('addstream', function(event) {
                self.dispatchEvent(event);
            });
            peer.addEventListener('removestream', function(event) {
                self.dispatchEvent(event);
            });
            peer.addEventListener('connectionClose', function(event) {
                self.dispatchEvent(event);
            });
            peer.addEventListener('message', function(event) {
                var message = JSON.parse(event.data);
                switch (message.type) {
                    case 'stream':
                        self._handleStreamMessage(message);
                        break;
                    default:
                        self.dispatchEvent(event);
                        break;
                }
            });

            peer.addEventListener('connectionClose', function(event) {
                self._disconnectFromPeer(event.detail);
                self.dispatchEvent(event);
            });
            peer.addEventListener('sendError', function(event) {
                self._signalingService.send(event.detail)
            });
            this._peers[remoteId] = peer;
            return peer;
        }
    },

    _handleStreamMessage: {
        value: function(message) {
            switch (message.cmd) {
                case 'detachAll':
                    this._peers[message.source].detachStream();
                    break;
                default:
                    console.log('Unknown ' + message.type + ' cmd:', message.cmd, message);
                    break;
            }
        }
    },

    addPeer: {
        value: function(remoteId) {
            if (remoteId !== this.id) {
                var peer = this._createPeer(remoteId);
                return peer.connectToPeer(remoteId);
            } else {
                return Promise.resolve();
            }
        }
    },

    updateTopology: {
        value: function(topology) {
            var oldTopology = this._topology || [];
            var currentIndex = oldTopology.indexOf(this.id);
            var changesBefore = currentIndex != topology.indexOf(this.id);
            if (!changesBefore) {
                for (var i = 0; i < currentIndex; i++) {
                    if (this._topology[i] != topology[i]) {
                        changesBefore = true;
                        break;
                    }
                }
            }

            this._topology = topology;
            this._cleanNodes();

            this.dispatchEventNamed('topologyChanged', true, true, {
                topology: topology,
                changesBefore: changesBefore
            });
        }
    },

    _disconnectFromPeer: {
        value: function (peerId) {
            var self = this;
            try {
                this._peers[peerId].quit();
            } catch(err) {
                delete self._peers[peerId];
            }
        }
    },

    _cleanNodes: {
        value: function() {
            for (var peerId in this._peers) {
                if (this._peers.hasOwnProperty(peerId)) {
                    if (this._topology.indexOf(peerId) == -1) {
                        this._disconnectFromPeer(peerId);
                    }
                }
            }
        }
    },

    quit: {
        value: function() {
            var self = this;
            for (var peerId in this._peers) {
                if (this._peers.hasOwnProperty(peerId)) {
                    self._disconnectFromPeer(peerId);
                }
            }
        }
    },

    getPeerAtDistance: {
        value: function(distance) {
            var index = this._topology.indexOf(this.id) + distance;
            return this._topology[index];
        }
    },

    refreshStream: {
        value: function(stream) {
            for (var targetId in this._streamTarget) {
                if (this._peers.hasOwnProperty(targetId)) {
                    this._peers[targetId].detachLocalStreams(targetId);
                    this.attachStreamToPeer(stream, targetId);
                }
            }
        }
    },

    attachStreamToPeer: {
        value: function(stream, target) {
            this._peers[target].attachStream(stream, target);
            if (this._streamTarget.indexOf(target) == -1) {
                this._streamTarget.push(target);
            }
        }
    },

    detachStreamFromPeer: {
        value: function(stream, target) {
            if (target) {
                this._peers[target].detachStream(stream, target);
                var targetIndex = this._streamTarget.indexOf(target);
                if (targetIndex != -1) {
                    this._streamTarget.splice(targetIndex, 1);
                }
            } else {
                for (var peerId in this._peers) {
                    if (this._peers.hasOwnProperty(peerId)) {
                        this._peers[peerId].detachStream(stream, peerId);
                        var peerIndex = this._streamTarget.indexOf(peerId);
                        if (peerIndex != -1) {
                            this._streamTarget.splice(peerIndex, 1);
                        }
                    }
                }
            }
        }
    },

    detachRemoteStreams: {
        value: function() {
            var message = {
                type: 'stream',
                cmd: 'detachAll'
            };
            for (var peerId in this._peers) {
                if (this._peers.hasOwnProperty(peerId)) {
                    this._peers[peerId].send(message, peerId);
                }
            }
        }
    },

    sendToPeer: {
        value: function(message, target) {
            var peer = this._peers[target];
            if (peer) {
                peer.send(message, target);
            }
        }
    }
});
