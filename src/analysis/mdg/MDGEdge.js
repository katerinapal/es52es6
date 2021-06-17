/**
 * http://usejsdoc.org/
 */

function MDGEdge(edgeType, importedElement, usageSet) {
	
	this.edgeType = edgeType;
	this.accessedElement = importedElement;
	this.usageSet = usageSet;
	
	this.printModuleDependency = function() {
		
		// console.log(this);
		var result = "edgeType: " + this.edgeType;
		result += "\nimportedElement: " + (this.accessedElement.elementName == null ? this.accessedElement.variableName : this.accessedElement.elementName) + ' ';
		result += (this.accessedElement.isCohesive === true ? 'cohesive' : 'non-cohesive');
//		result += JSON.stringify(this.importedElement, null, 4);
		result += "\n\nusageSet\n";
		if(this.usageSet !== null) {

			this.usageSet.forEach(function(usage) {
			
				// console.log(usage.value)
				if(usage.value.loc === null) {

					return;
				}

				//the latest version of jscodeshift introduces a new field named 'tokens'
				//which contains a list of objects (thus, the string that is written in the mdg file
				//is extremely big, thus yielding invalid string length errors)
				result += "start position: " + JSON.stringify(usage.value.loc.start, null, 4);
				result += "end position: " + JSON.stringify(usage.value.loc.end, null, 4);
				result += "\n";
			});
		}

		if(this.edgeType === 'NamespaceImport') {

			//in the case that the MDG edge represents a namespace import,
			//print the namespace's accessed properties
			// console.log(this.accessedElement);

			let accessedProperties = this.accessedElement.accessedProperties;
			accessedProperties.forEach(function(accessedProperty) {

				result += "accessedProperty: " + accessedProperty.propertyName + "\n";
				result += "access start loc\n" + JSON.stringify(accessedProperty.propertyUsageNode.loc.start, null, 4) + "\n";
				result += "access end loc\n" + JSON.stringify(accessedProperty.propertyUsageNode.loc.end, null, 4) + "\n"; 
			});
		}
		
		return result;
	};
}

exports.MDGEdge = MDGEdge;