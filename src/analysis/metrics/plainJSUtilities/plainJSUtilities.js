var path = require('path');

var jscodeshift = require('../../../../node_modules/jscodeshift');

var enums = require('../../ast/util/enums.js');
var commonUtilities = require('../commonUtilities.js');

var ImportedElement = require('../../ast/model/importedElement.js');
var ImportedModule = require('../../ast/model/importedModule.js');
var codeHierarchyUtilities = require('../../ast/util/codeHierarchyUtilities.js');
var fileUtilities = require('../../../io/fileUtilities.js');

//used to retrieve the number of the distinct modules that are imported 
//in the analyzed system
var distinctImportedModules = [];
exports.distinctImportedModules = distinctImportedModules;

//used to retrieve the number of the distinct external (libraries) 
//that are imported in the analyzed system
var distinctImportedExternalModules = [];
exports.distinctImportedExternalModules = distinctImportedExternalModules;

//used to retrieve the number of the import statements that are located in the analyzed system
var systemImportStatements = [];
exports.systemImportStatements = systemImportStatements;


/**
 * Retrieves the variables/functions imported in sourceFile.
 * @param {*} inputFiles 
 * @param {*} sourceFile 
 */
function retrieveImportedElementsOfJSFile(inputFiles, sourceFile) {

	//do not retrieve imported elements of an external library
	if(sourceFile.moduleType === enums.ModuleType.library) {

		return;
	}

    //sourceFile is a plain JS source file (code designed using no module systems)
    //no formal mechanism for variable/function imports - elements are imported through an explicit reference
    commonUtilities.addTopLevelDefinitionsToImportedDefinitionsOfModule(inputFiles, sourceFile);
}

/**
 * Retrieves the variables/functions exported from sourceFile.
 * @param {*} sourceFile 
 */
function retrieveExportedElementsOfJSFile(sourceFile) {

    //no formal mechanism for exporting definitions
    //each variable/function defined in the top-level scope is exported

	// console.log(sourceFile.fileName);
	sourceFile.explicitGlobals.forEach(explicitGlobal => {

		explicitGlobal.updateIsExported(true);
    });
    sourceFile.definedFunctions.forEach(definedFunction => {
		
		//exclude module functions comprising the right operands of assignments
		if(definedFunction.functionScope !== null ||
			definedFunction.functionName === 'topLevelScope') {

			return;
		}

		let surrStmts = jscodeshift(definedFunction.functionNode).closest(jscodeshift.Statement);
		// console.log(definedFunction.functionNode.value.loc);
		// console.log(surrStmts.length);
		// surrStmts.forEach(surrStmt => {

		// 	console.log(surrStmt.value.loc);
		// });

		if(surrStmts.length === 0) {

			//no statements surround function (it is located in the top-level scope of the module)
			definedFunction.updateIsExported(true);
		}

		// if(definedFunction.functionScope === null &&
		// 	definedFunction.functionName !== 'topLevelScope' &&
		// 	definedFunction.functionNode.parentPath.value.type !== 'AssignmentExpression') {
		
		// 	//topLevelScope is an artificially created node,
		// 	//in order to model the top-level scope of the JS file
		// 	//(topLevelScope does not correspond to a function in the source code)
        //     definedFunction.updateIsExported(true);
					
		// }
	});
}

exports.retrieveImportedElementsOfJSFile = retrieveImportedElementsOfJSFile;
exports.retrieveExportedElementsOfJSFile = retrieveExportedElementsOfJSFile;