function ClassDeclaration(className, classDeclarationASTNode) {

    this.className = className;
    this.classDeclarationASTNode = classDeclarationASTNode;
    
    //enclosing scope: the function containing the class declaration
    this.enclosingScope = null;
    this.updateEnclosingScope = function(enclosingScope) {

        this.enclosingScope = enclosingScope;
    };

    this.isExported = false;
    this.updateIsExported = function(isExported) {

        this.isExported = isExported;
    };

    this.exportedClassNode = null;
    this.updateExportedClassNode = function(exportedClassNode) {

        this.exportedClassNode = exportedClassNode;
    };

    this.exportedThroughModuleExports = false;
    this.updateExportedThroughModuleExports = function(exportedThroughModuleExports) {

        this.exportedThroughModuleExports = exportedThroughModuleExports;
    };
}

exports.ClassDeclaration = ClassDeclaration;