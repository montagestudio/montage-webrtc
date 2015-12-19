/**
 * @module topology-service
 */
var Target = require("montage/core/target").Target;
/**
 * @class TopologyService
 * @extends Montage
 */
exports.TopologyService = Target.specialize(/** @lends TopologyService# */ {
    _nodesList: {
        value: []
    },

    addNode: {
        value: function(id) {
            this._nodesList.push(id);
            this.dispatchEventNamed('topologyChanged', true, true, this._nodesList);
        }
    },

    removeNode: {
        value: function(id) {
            this._nodesList = this._nodesList.filter(function(x) { return !(x.split('P')[0] === id.split('P')[0]) });
            this.dispatchEventNamed('topologyChanged', true, true, this._nodesList);
        }
    },

    getTopology: {
        value: function() {
            return this._nodesList;
        }
    }
});
