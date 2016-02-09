/**
 * @module client-topology-service
 */
var Target = require("montage/core/target").Target;
/**
 * @class ClientTopologyService
 * @extends Montage
 */
exports.ClientTopologyService = Target.specialize(/** @lends ClientTopologyService# */ {
    _peers: { value: null },

    constructor: {
        value: function() {
            this._peers = [];
        }
    },

    addPeer: {
       value: function(peerId) {
            this._peers.push(peerId);
            this._peers.sort();
        }
    },

    removePeer: {
        value: function(peerId) {
            var peerIndex = this._peers.indexOf(peerId);
            if (peerIndex != -1) {
                this._peers.splice(peerIndex, 1);
            }
        }
    },

    removePeers: {
        value: function(peerIds) {
            for (var i = 0, peerIdsCount = peerIds.length; i < peerIdsCount; i++) {
                this.removePeer(peerIds[i]);
            }
        }
    },

    getPeers: {
        value: function() {
            return this._peers;
        }
    }
});
