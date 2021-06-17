// Project specific assertions
const statUtils = require('../../src/tool/statisticsUtilities');

/**
 * 
 * @param {SourceFile} ast The source file ast
 * @param {int} exportStatements : Number of export statements included in module
 * @param {int} namedExports : Number of named exports 
 * that should be introduced after refactoring
 */
function assertModuleExports(ast, exportStatements, namedExports){

    var stmts = statUtils.retrieveNumberOfExportStatementsOfModule(ast);
    //console.log(ast);
    //console.log(ast.objectLiteral);
    expect(stmts).toBe(exportStatements);

    
    var declarations = statUtils.retrieveNumberOfExportedDeclarationsOfModule(ast);

    expect(declarations).toBe(namedExports);
}

/**
 * Asserts whether the given source file declares either a utility module, a class module
 * or nothing (0, 0).
 * 
 * @param {SourceFile} ast Ast of a source file
 * @param {Boolean} utilityModule The source file declare a utility module
 * @param {Boolean} classModule The source file declare a class module
 */
function assertModuleType(ast, utilityModule, classModule){
    var type = statUtils.retrieveModuleType(ast);
    expect(type.isUtilityModule).toBe(utilityModule);
    expect(type.isClassModule).toBe(classModule);
}

module.exports.assertModuleExports = assertModuleExports;
module.exports.assertModuleType = assertModuleType;