function GlobalObjectProperty(propertyName, propertyDefinitionNode) {

   this.elementName = propertyName;
   this.propertyDefinitionNode = propertyDefinitionNode;
  
   //by default, each global object property is exported (visible to other module)
   //if there do not exist any usages of the property in any module
   //this property is not exported (a codemod for the limitation of the property's scope is needed)
   this.isExported = true;
   this.updateIsExported = function(isExported) {

        this.isExported = isExported;
   };

   //the function that, when called/executed, introduces the property
   //in the global namespace (window/global)
   this.definitionFunction = null;
   this.updateDefinitionFunction = function(definitionFunction) {

      this.definitionFunction = definitionFunction;
   };

   this.isAssigned = false;
   this.updateIsGlobalPropertyAssignedAValue = function(isAssigned) {

      this.isAssigned = isAssigned;
   };

   /**
     * Is global object property specifying a feature (property) named propertyName?
     * @param {*} propertyName the property's name
     */
    this.importedFeatureSpecifiesFeature = function(propertyName) {

      //is global object property pointing to a module feature named propertyName?
      return this.elementName === propertyName;
    };

   this.compare = function(globalObjProp) {

      if(this.elementName === globalObjProp.elementName &&
         this.propertyDefinitionNode.value === globalObjProp.propertyDefinitionNode.value) {

            return true;
      }

      return false;
   };
}

exports.GlobalObjectProperty = GlobalObjectProperty;