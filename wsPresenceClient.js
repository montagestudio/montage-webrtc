var Target = require("montage/core/target").Target,
    Promise = require('montage/core/promise').Promise,
    Uuid = require('montage/core/uuid');

var clients = {};

exports.WsPresenceClient = Target.specialize({
    _id: { value: null },
    _presenceEndpoint: { value: null },
    _messages: { value: null },
    _presenceServer: { value: null },

    constructor: {
        value: function() {
            this._id = this._generateId();
            this._messages = {};
        }
    },

    init: {
        value: function(presenceEndpointUrl, rtcService, isServer) {
            var self = this;
            if (clients[presenceEndpointUrl]) {
                return clients[presenceEndpointUrl];
            }
            this._presenceEndpoint = presenceEndpointUrl;
            this._rtcService = rtcService.init(this._id, isServer);
            this._rtcService.addEventListener('signalingMessage', function(event) {
                self._send(event.detail);
            }, false);
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

                self._presenceServer.onclose = function(code) {
                    self.dispatchEventNamed('close');
                };
            });
        }
    },

    createRoom: {
        value: function(name, id) {
            var self = this;
            id = id || Uuid.generate();
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
                    self._rtcService.setRoomId(id);
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
            var self = this;
            return this._ensureConnected()
                .then(function() {
                    return self._rtcService.sendOffer(id);
                })
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
                        .then(function (response) {
                            return response.data;
                        });
                }).timeout(2000);
        }
    },

    closeRoom: {
        value: function(id) {
            var self = this;
            return this._rtcService.disconnect()
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

    _ensureConnected: {
        value: function() {
            if (!this._presenceServer || this._presenceServer.readyState > 1) {
                return this.connect();
            } else {
                return Promise.resolve();
            }
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
            var request,
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
                        this._rtcService.handleSignalingMessage(message);
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

    _generateId: {
        value: function(prefix) {
            prefix = prefix || '';
            return prefix + Date.now() + 'C' + Math.round(Math.random() * 1000000);
        }
    }
});
