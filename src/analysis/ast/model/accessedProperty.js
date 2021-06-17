/**
 * AccessedProperty.js. Constructor function for objects representing accessed properties of imported namespaces in CommonJS modules.
 */

function AccessedProperty(propertyName, propertyUsageNode) {

    this.propertyName = propertyName;
    this.propertyUsageNode = propertyUsageNode;
    
    this.accessedPropertyUses = [];
}

exports.AccessedProperty = AccessedProperty;