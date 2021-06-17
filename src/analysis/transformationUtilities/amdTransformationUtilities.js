/**
 * 
 */

var fs = require('fs');
var path = require('path');

var jscodeshift = require('../../../node_modules/jscodeshift');
var mkdirp = require('../../../node_modules/mkdirp');

var util = require('../ast/util/util.js');

/**
 * Codemods (JS scripts that perform transforms to the AST of every JS source file of the analyzed system).
 */

//AMD-specific codemods (codemods that are applied only in AMD modules)
var export_iife = require('../../refactoring/modules/generic/export_IIFE.js');

var replace_requireCallExpression = require('../../refactoring/modules/amd/replace_requireCallExpression');
var replace_defineCallExpression = require('../../refactoring/modules/amd/replace_defineCallExpression');
var export_literal = require('../../refactoring/modules/amd/remove_returnStatement.js');
var export_variable = require('../../refactoring/modules/amd/export_variable.js');
var export_function = require('../../refactoring/modules/amd/export_function.js');
var remove_requireHook = require('../../refactoring/modules/amd/remove_requireHook.js');

//generic codemods (codemods that could be applied in JS code created without a module framework)
var insert_import = require('../../refactoring/modules/generic/insert_import.js');
var insert_named_import = require('../../refactoring/modules/generic/insert_named_import.js');
var export_default_variable = require('../../refactoring/modules/generic/export_default_variable.js');
var export_implied_global = require('../../refactoring/modules/generic/export_implied_global.js');
var introduce_implied_global_definition = require('../../refactoring/modules/generic/introduce_implied_global_definition.js');
var insert_moduleVariableModificationFunction = require('../../refactoring/modules/generic/insert_moduleVariableModificationFunction.js');
// var replace_moduleVariableModification = require('../../refactoring/modules/generic/replace_moduleVariableModification.js');
var create_variableBinding = require('../../refactoring/modules/generic/create_variableBinding.js');

var introduce_global_property_definition = require('../../refactoring/modules/generic/introduce_global_object_property_definition.js');
var introduce_global_property_getter_call = require('../../refactoring/modules/generic/introduce_global_property_getter_call.js');
var introduce_global_property_setter_function = require('../../refactoring/modules/generic/introduce_global_property_setter_function.js');
var introduce_global_property_setter_call = require('../../refactoring/modules/generic/introduce_global_property_setter_call.js');
var replace_global_property_reference_with_module_variable_reference = require('../../refactoring/modules/generic/replace_global_property_reference_with_module_variable_reference.js');

function transformAMDModule(fileInfo, transformationList) {

	let refactoredImportStatements = 0;

	let initialNamedImports = 0;
	let initialDefaultImports = 0;
	let initialImports = 0;

	let es6NamedImports = 0;
	let es6DefaultImports = 0;
	let es6Imports = 0;

	let destructuredObjects = 0;
	let exportedProperties = 0;

	let filePath = fileInfo.fileName;
	
	let astRootCollection = util.createASTOfModule(filePath);
	let fileTokens = filePath.split('\\');
	let inputFileName = fileTokens[fileTokens.length-1];
	
	//write file with the initial code
	// fs.writeFileSync('./intermediateResults/' + path.basename(inputFileName) + '_initialCode.js', astRootCollection.toSource(), 'utf-8');
	
	//apply transformations to the AST of sourceFile
	//first apply all transformations regarding module dependency integration to ES6 (ES6 imports/exports)
	//last apply all transformations regarding module integration to ES6 (define()/require()/requirejs() invocations)
	let moduleDepIntegrationTransformations = transformationList.filter(transformation => {

		return transformation.type !== 'replace_call';
	});

	let moduleIntegrationTransformations = transformationList.filter(transformation => {

		return transformation.type === 'replace_call';
	});

	let transformationArray = moduleDepIntegrationTransformations;
	transformationArray = transformationArray.concat(moduleIntegrationTransformations);

	transformationArray.forEach(transformation => {
		
//		console.log(transformation);
		
		console.log('transforming ' + filePath + '...');
		
		//retrieve script of corresponding transformation
		var transformationType = transformation['type'];
		
		//retrieve data needed to apply the transformation
		var transformationInfo = transformation['transformationInfo'];
		transformationInfo.filePath = filePath;

		console.log(transformationType)

		// console.log(transformationInfo);
		if(transformationType === 'insert_import') {

			refactoredImportStatements++;
			
			//(i) replace require() hook with the body of the callback function given as third parameter to require()
			// replace_requireCallExpression.refactoring(jscodeshift, astRootCollection, transformationInfo);

			//(ii) insert import statement at the top of the AST representing the JS file (create an ES6 named import)
			insert_import.refactoring(jscodeshift, astRootCollection, transformationInfo);

			//in AMD modules all imports are default, 
			//since the referenced declarations are returned from the callbacks provided in define()
			//in their definition modules
			initialDefaultImports++;
			initialImports++;

			//in the transformed ES6 module, the introduced ES6 import is named
			//(since the respective ES6 export is named - control flow of module declarations among the system's modules
			//is preserved)
			es6NamedImports++;
			es6Imports++;

			//(iii) module contains modifications of the imported variable
			//when refactored to ES6, a runtime error is introduced, as imported variable modification is not allowed in ES6
			//(a) import the modification function in module
			//(b) rename all modifications of module variables to call expressions to the modification function
			if(transformationInfo.dependencyType === 'GlobalDefinition') {

				create_variableBinding.refactoring(jscodeshift, astRootCollection, transformationInfo);
			}

			// console.log(transformationInfo);
			// console.log(transformationInfo.importedElement.modificationFunctions);
		}
		else if(transformationType === 'insert_named_import') {

			//case: AMD module imports elements from a plain JS module - introduce ES6 named imports
			insert_named_import.refactoring(jscodeshift, astRootCollection, transformationInfo);

			initialDefaultImports++;
			initialImports++;

			es6NamedImports++;
			es6Imports++;
		}
		else if(transformationType === 'export_variable') {

			//replace builtin function invocation with its callback's body
			//is decoupled from exporting
			export_variable.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'export_function') {

			//replace builtin function invocation with its callback's body
			//is decoupled from exporting
			export_function.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'export_implied_global') {

			//transform implied global into an explicit global and mark it as exported
			//(an implied global is visible in all js scripts, due to its assignment in the global namespace)
			export_implied_global.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'export_object_with_properties') {

			export_literal.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if (transformationType === 'replace_call') {

			//(i) replace define() hook with the body of the callback function given as third parameter to define()
			let resultObject = replace_defineCallExpression.refactoring(jscodeshift, astRootCollection, transformationInfo);
			// console.log(resultObject);

			if(resultObject.isExportedElementAnObject === true) {

				//the declaration returned from the callback provided in define()
				//is an object - retrieve information relevant to whether the object is destructured
				//and the number of properties that are actually exported
				destructuredObjects++;
				exportedProperties += resultObject.exportedProperties;
			}
		}
		else if(transformationType === 'export_IIFE') {

			//replace the IIFE with an ES6 export default statement
			export_iife.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'introduce_implied_global_definition') {

			//implied global used only throughout its definition module
			//introduce variable definition
			introduce_implied_global_definition.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'introduce_global_property_definition') {

			// GOPD dependency establishment
			introduce_global_property_definition.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'introduce_global_property_getter_call') {

			//GOPU dependency establishment
			// introduce_global_property_getter_call.refactoring(jscodeshift, astRootCollection, transformationInfo);

			replace_global_property_reference_with_module_variable_reference(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'introduce_global_property_setter_call') {

			//GOPM dependency establishment in a module that modifies a global oblect property
			introduce_global_property_setter_call.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		else if(transformationType === 'introduce_global_property_setter_function') {

			//GOPM dependency establishment in a module that defines a global object property
			//that is modified in other modules
			introduce_global_property_setter_function.refactoring(jscodeshift, astRootCollection, transformationInfo);
		}
		

	});

	//update: what if module contains require hooks? (calls to require(), where the modules referenced 
	//in the module dependency array are not mapped to parameters of the callback function given as the call's last parameter)
	//this transformation is not modelled in the MDG (and, consequently, in the transformation json file, as the module does not
	//import anything)
	remove_requireHook.refactoring(jscodeshift, astRootCollection);
	
	// var refactoredFileName = './refactoringResults/' + inputFileName;

	return {

		"filePath" : filePath,
		"astRootCollection": astRootCollection,
		"refactoredImportStatements": refactoredImportStatements,
		"initialNamedImports": initialNamedImports,
		"initialDefaultImports": initialDefaultImports,
		"initialImports": initialImports,
		"es6NamedImports": es6NamedImports,
		"es6DefaultImports": es6DefaultImports,
		"es6Imports": es6Imports,
		"destructuredObjects": destructuredObjects,
		"exportedProperties": exportedProperties
	};
	
//	fs.writeFileSync('./intermediateResults/' + inputFileName + '_transformedCode.js', astRootCollection.toSource(), 'utf-8');
}

exports.transformAMDModule = transformAMDModule;