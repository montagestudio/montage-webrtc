/**
 * @module topology-service
 */
var Target = require("montage/core/target").Target;
/**
 * @class ServerTopologyService
 * @extends Montage
 */
exports.ServerTopologyService = Target.specialize(/** @lends ServerTopologyService# */ {
    _nodesList: { value: null },
    _nodesConnections: { value: null },

    constructor: {
        value: function() {
            this._nodesList = [];
            this._nodesConnections = {};
        }
    },

    updateNodeConnections: {
        value: function(nodeId, connections) {
            var self = this;
            if (!this._nodesConnections[nodeId]) {
                this._nodesConnections[nodeId] = [];
            }
            var filteredConnections = connections.filter(function(x) { return self._nodesConnections[nodeId].indexOf(x) == -1 });
            this._nodesConnections[nodeId] = this._nodesConnections[nodeId].concat(filteredConnections);
            for (var i = 0, connectionsCount = connections.length; i < connectionsCount; i++) {
                var connection = connections[i];
                if (!this._nodesConnections[connection]) {
                    this._nodesConnections[connection] = [];
                }
                if (this._nodesConnections[connection].indexOf(nodeId) == -1) {
                    this._nodesConnections[connection].push(nodeId);
                }
            }
            this._sortNodesByConnections();
        }
    },

    removeNode: {
        value: function(nodeId) {
            var matchingIds = Object.keys(this._nodesConnections).filter(function(x) { return x.split('P')[0] == nodeId.split('P'[0]) });
            for (var i = 0, matchingIdsCount = matchingIds.length; i < matchingIdsCount; i++) {
                this._removeNodeWithId(matchingIds[i])
            }
            this._sortNodesByConnections();
            return matchingIds;
        }
    },

    hasNode: {
        value: function(nodeId) {
            return !!this._nodesConnections[nodeId];
        }
    },

    _removeNodeWithId: {
        value: function(nodeId) {
            delete this._nodesConnections[nodeId];
            var remainingNodesIds = Object.keys(this._nodesConnections);
            for (var i = 0, nodesCount = remainingNodesIds.length; i < nodesCount; i++) {
                var nodeConnections = this._nodesConnections[remainingNodesIds[i]];
                var removedNodeIndex = nodeConnections.indexOf(nodeId);
                if (removedNodeIndex != -1) {
                    nodeConnections.splice(removedNodeIndex, 0);
                }
            }
        }
    },

    getPaths: {
        value: function() {
            var paths = [],
                orphanNodes = this._nodesList.map(function(x) { return x.id; });
            while (orphanNodes.length > 0) {
                var root = orphanNodes.shift(),
                    path = [root],
                    next = this._getNextNode(orphanNodes, root, path);
                while (next) {
                    path.push(next);
                    root = next;
                    next = this._getNextNode(orphanNodes, root, path);
                }
                paths.push(path);
            }
console.log(paths);
            return paths;
        }
    },

    _getNextNode: {
        value: function(orphanNodes, current, path) {
            var MAX_PATH_LENGTH = 1;
            if (path.length < MAX_PATH_LENGTH) {
                var candidate,
                    i;
                if (path.length === MAX_PATH_LENGTH -1) {
                    for (i = orphanNodes.length-1, minNode = orphanNodes.indexOf(current); i > minNode; i--) {
                        candidate = orphanNodes[i];
                        if (this._nodesConnections[candidate].indexOf(current) != -1) {
                            orphanNodes.splice(i, 1);
                            return candidate;
                        }
                    }
                } else {
                    for (i = orphanNodes.indexOf(current)+1, nodesCount = orphanNodes.length; i < nodesCount; i++) {
                        candidate = orphanNodes[i];
                        if (this._nodesConnections[candidate].indexOf(current) != -1) {
                            orphanNodes.splice(i, 1);
                            return candidate;
                        }
                    }
                }
            }
        }
    },

    _sortNodesByConnections: {
        value: function() {
            var tempNodesList = [],
                nodesIds = Object.keys(this._nodesConnections);
            for (var i = 0, nodesCount = nodesIds.length; i < nodesCount; i++) {
                var nodeId = nodesIds[i];
                tempNodesList.push({
                    id: nodeId,
                    connectionsCount: this._nodesConnections[nodeId].length
                });
                this._nodesList = tempNodesList.sort(this._nodesComparator);
            }
        }
    },

    _nodesComparator: {
        value: function(nodeA, nodeB) {
            if (nodeA.connectionsCount < nodeB.connectionsCount) {
                return 1;
            } else if (nodeA.connectionsCount > nodeB.connectionsCount) {
                return -1
            } else if (nodeA.id == nodeB.id) {
                return 0;
            } else {
                return nodeA.id > nodeB.id ? 1 : -1;
            }
        }
    },

    addNode: {
        value: function(id) {
            this._nodesList.push(id);
            this.dispatchEventNamed('topologyChanged', true, true, this._nodesList);
        }
    },

    removeNodeOld: {
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
