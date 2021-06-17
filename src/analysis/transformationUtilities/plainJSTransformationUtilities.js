/**
 * Module form performing transformations in plain JS modules.
 */

var fs = require('fs');
var path = require('path');

var jscodeshift = require('../../../node_modules/jscodeshift');
var mkdirp = require('../../../node_modules/mkdirp');

var util = require('../ast/util/util.js');

//generic codemods (codemods that can be applied in JS code, regardless of the module system used for development)
var export_function = require('../../refactoring/modules/generic/export_function.js');
var export_variable = require('../../refactoring/modules/generic/export_variable.js');
var insert_named_import = require('../../refactoring/modules/generic/insert_named_import.js');
var export_implied_global = require('../../refactoring/modules/generic/export_implied_global.js');
var insert_module_import = require('../../refactoring/modules/generic/insert_module_import.js');
var export_IIFE = require('../../refactoring/modules/generic/export_IIFE.js');
var introduce_implied_global_definition = require('../../refactoring/modules/generic/introduce_implied_global_definition.js');

//plain JS specific codemods
var insert_modification_function = require('../../refactoring/modules/generic/insert_moduleVariableModificationFunction');
var replace_moduleVariableModification = require('../../refactoring/modules/generic/replace_moduleVariableModification.js');

function transformPlainJSModule(fileInfo, transformationList) {
	
	let filePath = fileInfo.fileName;
	let astRootCollection = util.createASTOfModule(filePath);
	let fileTokens = filePath.split('\\');
	let inputFileName = fileTokens[fileTokens.length-1];

	let initialNamedImports = 0;
	let initialDefaultImports = 0;
	let initialImports = 0;
	let es6NamedImports = 0;
	let es6DefaultImports = 0;
	let refactoredImportStatements = 0;
	let destructuredObjects = 0;
	let exportedProperties = 0;
	let isUtilityModule;
	let exportedDeclarations = 0;
	
	//write file with the initial code
	// fs.writeFileSync('./intermediateResults/' + inputFileName + '_initialCode.js', astRootCollection.toSource(), 'utf-8');
	
	//attempt to apply each transformation to AST of sourceFile
	transformationList.forEach(function(transformation) {
		
//		console.log(transformation);
		
		console.log('transforming ' + filePath + '...');
		
		//retrieve script of corresponding transformation
		var transformationType = transformation['type'];
		
		//retrieve data needed to apply the transformation
		var transformationInfo = transformation['transformationInfo'];

		// console.log(astRootCollection.toSource())
		console.log(transformationType);
		
		if(transformationType === 'export_function') {

		// 	//replace function definition with an ES6 named export (case: an AMD module imports a function from module pointed by filePath)
			export_function.refactoring(jscodeshift, astRootCollection, transformationInfo);

			if(transformationInfo.exportedElement.isFunctionConstructor === false) {

				//exported function not used for creating objects
				isUtilityModule = true;
			}

			exportedDeclarations++;
		}
		else if(transformationType === 'export_variable') {

			if(transformationInfo.exportedElement.modificationFunctions.length > 0) {

				//the exported variable is modified in other modules
				//create a function containing the modification statement
				//and insert it at the top-level scope of the module
				insert_modification_function.refactoring(jscodeshift, astRootCollection, transformationInfo);
			}

			export_variable.refactoring(jscodeshift, astRootCollection, transformationInfo);

			exportedDeclarations++;
		}
		else if (transformationType === 'insert_named_import') {

			insert_named_import.refactoring(jscodeshift, astRootCollection, transformationInfo);

			//GlobalDefinition dependency (the imported variable is modified)
			if(transformationInfo.dependencyType === 'GlobalDefinition') {

				//replace the imported variable modification statement with a call site to the inserted modification function
				replace_moduleVariableModification.refactoring(jscodeshift, astRootCollection, transformationInfo);
			}

			//in non-modular ES5 modules, only ES6 named imports/exports are introduced
			es6NamedImports++;
		}
		else if(transformationType === 'export_implied_global') {

			//transform implied global into an explicit global and mark it as exported
			//(an implied global is visible in all js scripts, due to its assignment in the global namespace)
			if(transformationInfo.exportedElement.modificationFunctions !== undefined) {

				//the exported variable is modified in other modules
				//create a function containing the modification statement
				//and insert it at the top-level scope of the module
				insert_modification_function.refactoring(jscodeshift, astRootCollection, transformationInfo);
			}

			export_implied_global.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'insert_import') {

			//insert import: plain JS module introduces elements from a module that does not
			//export elements (i.e. it is an IIFE)
			insert_module_import.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'export_IIFE') {

			//plain JS module comprises an IIFE (case: backbone in Todos)
			export_IIFE.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'introduce_implied_global_definition') {

			//introduce definition of an implied global defined and used only within its definition module
			introduce_implied_global_definition.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
	});
	
	// var refactoredFileName = './refactoringResults/' + inputFileName;

	return {

		"filePath" : filePath,
		"astRootCollection": astRootCollection,
		"initialNamedImports": initialNamedImports,
		"initialDefaultImports": initialDefaultImports,
		"initialImports": initialImports,
		"es6NamedImports" : es6NamedImports,
		"es6DefaultImports": es6DefaultImports,
		"refactoredImportStatements": refactoredImportStatements,
		"destructuredObjects": destructuredObjects,
		"exportedProperties": exportedProperties,
		"isUtilityModule": isUtilityModule,
		"exportedDeclarations": exportedDeclarations
	};
	
//	fs.writeFileSync('./intermediateResults/' + inputFileName + '_transformedCode.js', astRootCollection.toSource(), 'utf-8');
}

exports.transformPlainJSModule = transformPlainJSModule;