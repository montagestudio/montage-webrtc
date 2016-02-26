var Target = require("montage/core/target").Target,
    Promise = require('montage/core/promise').Promise,
    Uuid = require('montage/core/uuid'),
    RTCService = require("./client").RTCService;

var clients = {};

exports.WsPresenceClient = Target.specialize({
    _id: { value: null },
    _presenceEndpoint: { value: null },
    _messages: { value: null },
    _presenceServer: { value: null },
    _roomId: { value: null },

    rtcService: {
        get: function() {
            return this._rtcServices.default;
        }
    },

    rtcServices: {
        get: function() {
            return this._rtcServices;
        }
    },

    constructor: {
        value: function() {
            this._id = this._generateId();
            this._messages = {};
        }
    },

    init: {
        value: function(presenceEndpointUrl, isServer) {
            if (clients[presenceEndpointUrl]) {
                return clients[presenceEndpointUrl];
            }
            this._presenceEndpoint = presenceEndpointUrl;

            this._rtcServices = {};
            if (!isServer) {
                this._initializeClient();
            }

            return this;
        }
    },

    connect: {
        value: function() {
            var self = this;
            return new Promise.Promise(function(resolve, reject) {
                self._presenceServer = new WebSocket(self._presenceEndpoint);

                self._presenceServer.onmessage = function(message) {
                    self._handleMessage(message);
                };

                self._presenceServer.onopen = function() {
                    resolve();
                };

                self._presenceServer.onerror = function(err) {
                    reject(err)
                };

                self._presenceServer.onclose = function() {
                    self.dispatchEventNamed('close');
                };
            });
        }
    },

    createRoom: {
        value: function(name, id) {
            var self = this;
            id = id || Uuid.generate();
            this._roomId = id;
            return this._ensureConnected()
                .then(function() {
                    var message = {
                        id: self._generateId('M'),
                        source: self._id,
                        type: 'presence',
                        cmd: 'createRoom',
                        data: {
                            id: id,
                            name: name
                        }
                    };
                    self._send(message);
                    return self._storeMessagePromise(message);
                })
                .then(function(response) {
                    return response.data;
                });
        }
    },

    lock: {
        value: function(room) {
            var self = this;
            return this._ensureConnected()
                .then(function() {
                    var message = {
                        id: self._generateId('M'),
                        source: self._id,
                        type: 'presence',
                        cmd: 'lock',
                        data: {
                            id: room.id
                        }
                    };

                    self._send(message);
                    return self._storeMessagePromise(message)
                        .then(function(response) {
                            return response.data
                        });
                })
        }
    },

    unlock: {
        value: function(room) {
            var self = this;
            return this._ensureConnected()
                .then(function() {
                    var message = {
                        id: self._generateId('M'),
                        source: self._id,
                        type: 'presence',
                        cmd: 'unlock',
                        data: {
                            id: room.id
                        }
                    };

                    self._send(message);
                    return self._storeMessagePromise(message)
                        .then(function(response) {
                            return response.data
                        });
                })
        }
    },

    listOpenRooms: {
        value: function() {
            var self = this;
            return this._ensureConnected()
                .then(function() {
                    var message = {
                        id: self._generateId('M'),
                        source: self._id,
                        type: 'presence',
                        cmd: 'listRooms'
                    };
                    self._send(message);
                    return self._storeMessagePromise(message);
                })
                .then(function(response) {
                    return response.data.roomIds;
                });
        }
    },

    findRoomByCode: {
        value: function(code) {
            var self = this;
            return this._ensureConnected()
                .then(function() {
                    var message = {
                        id: self._generateId('M'),
                        source: self._id,
                        type: 'presence',
                        cmd: 'findRoomByCode',
                        data: {
                            code: code
                        }
                    };
                    self._send(message);
                    return self._storeMessagePromise(message)
                        .then(function (response) {
                            return response.data;
                        });
                });
        }
    },

    joinRoom: {
        value: function(id) {
            var self = this,
                room;
            return this._ensureConnected()
                .then(function() {
                    var message = {
                        id: self._generateId('M'),
                        source: self._id,
                        type: 'presence',
                        cmd: 'getRoom',
                        data: {
                            id: id
                        }
                    };
                    self._send(message);
                    return self._storeMessagePromise(message)
                })
                .then(function (response) {
                    room = response.data;
                    return self._rtcServices.default.connect(id);
                })
                .then(function() {
                    return room;
                });
        }
    },

    closeRoom: {
        value: function(id) {
            var self = this,
                disconnectionPromises = [];
            for (var rtcServiceId in this._rtcServices) {
                if (this._rtcServices.hasOwnProperty(rtcServiceId)) {
                    disconnectionPromises.push(this._rtcServices[rtcServiceId].quit());
                }
            }
            return Promise.all(disconnectionPromises)
                .then(function() {
                    if (self._presenceServer && self._presenceServer.readyState === 1) {
                        var message = {
                            id: self._generateId('M'),
                            source: self._id,
                            type: 'presence',
                            cmd: 'closeRoom',
                            data: {
                                id: id
                            }
                        };
                        self._send(message);
                        return self._storeMessagePromise(message)
                            .then(function() {
                                self.disconnect();
                            });
                    }
                });
        }
    },

    disconnect: {
        value: function() {
            this._presenceServer.close(1000);
        }
    },

    sendToClients: {
        value: function(message) {
            for (var clientId in this._rtcServices) {
                if (this._rtcServices.hasOwnProperty(clientId)) {
                    this.sendToClient(message, clientId);
                }
            }
        }
    },

    sendToClient: {
        value: function(message, clientId) {
            this._rtcServices[this._removePeerId(clientId)].send(message);
        }
    },

    removeClient: {
        value: function(clientId) {
            try {
                this._rtcServices[clientId].quit();
            } catch (err) {
            } finally {
                delete this._rtcServices[clientId];
            }
        }
    },

    attachStreamToClient: {
        value: function(stream, clientId) {
            try {
                this._rtcServices[clientId].attachStream(stream);
            } catch (err) {
                console.log('Cannot attach stream to client:', clientId, err);
            }
        }
    },

    detachStreamFromClient: {
        value: function(stream, clientId) {
            try {
                this._rtcServices[clientId].detachStream(stream);
            } catch (err) {
                console.log('Cannot attach stream to client:', clientId, err);
            }
        }
    },

    _ensureConnected: {
        value: function() {
            if (!this._presenceServer || this._presenceServer.readyState > 1) {
                return this.connect();
            } else {
                return Promise.resolve();
            }
        }
    },

    _initializeClient: {
        value: function () {
            var self = this;
            this._rtcServices.default = new RTCService().init(this._id);
            var signalingMessageListener = function (event) {
                self._send(event.detail);
            };
            this._rtcServices.default.addEventListener('signalingMessage', signalingMessageListener, false);
            this._rtcServices.default.addEventListener('switchToP2P', function () {
                self._rtcServices.default.removeEventListener('signalingMessage', signalingMessageListener);
                self.disconnect();
            }, false);
        }
    },

    _storeMessagePromise: {
        value: function(message) {
            var self = this,
                deferred = Promise.defer();
            this._messages[message.id] = {
                timestamp: Date.now(),
                message: message,
                promise: deferred
            };

            return deferred.promise
                .then(function(message) {
                    delete self._messages[message.id];
                    return message;
                });
        }
    },

    _send: {
        value: function(message) {
            if (message) {
                this._presenceServer.send(JSON.stringify(message));
            } else {
                console.trace('Empty message');
            }
        }
    },

    _handleMessage: {
        value: function(socketMessage) {
            var self = this,
                request,
                message = JSON.parse(socketMessage.data);
            if (message.source && message.source === this._id) {
                if (message.id && (request = this._messages[message.id])) {
                    if (message.success) {
                        request.promise.resolve(message);
                    } else {
                        request.promise.reject(message);
                    }
                }
            } else {
                switch (message.type) {
                    case 'webrtc':
                        if (this._rtcServices.default) {
                            this._rtcServices.default.handleSignalingMessage(message);
                        } else {
                            var rtcService = this._rtcServices[message.source];
                            if (!rtcService) {
                                rtcService = new RTCService().init(this._id);
                                rtcService.setRoomId(self._roomId);
                                rtcService.addEventListener('signalingMessage', function(event) {
                                    self._send(event.detail);
                                }, false);
                                rtcService.addEventListener('clientError', function(event) {
                                    event.remoteId = message.source;
                                    self.dispatchEvent(event);
                                });
                                rtcService.addEventListener('message', function(event) {
                                    self.dispatchEvent(event);
                                });
                                rtcService.addEventListener('addstream', function(event) {
                                    event.remoteId = message.source;
                                    self.dispatchEvent(event);
                                });
                                rtcService.addEventListener('forwardMessage', function(event) {
                                    self._forwardMessage(event.detail);
                                });
                                rtcService.addEventListener('connectionClose', function(event) {
                                    self.dispatchEvent(event);
                                });

                                this._rtcServices[message.source] = rtcService;
                            }
                            rtcService.handleSignalingMessage(message);
                        }
                        break;
                    case 'roomChange':
                        this.dispatchEventNamed('roomChange', true, true);
                        break;
                    default:
                        console.log('Received unknown message type:', message.type);
                        break;
                }
            }
        }
    },

    _forwardMessage: {
        value: function(message) {
            var target = this._rtcServices[this._removePeerId(message.data.targetClient)];
            if (target) {
                target.send(message);
            } else {
                console.log('Unknown target', message.data.targetClient, message);
            }
        }
    },

    _generateId: {
        value: function(prefix) {
            prefix = prefix || '';
            return prefix + Date.now() + 'C' + Math.round(Math.random() * 1000000);
        }
    },

    _removePeerId: {
        value: function(clientId) {
            return clientId.split('P')[0];
        }
    }
});
