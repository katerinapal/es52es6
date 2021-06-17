const assertions = require('../util/assertions')
const projectUtils = require('../util/project-utils')
const findFile = projectUtils.findFile;
const utils = require('../../src/analysis/ast/util/util.js');
const ModuleFramework = require('../../src/analysis/ast/util/enums.js').ModuleFramework;
const fileUtils = require('../../src/io/fileUtilities.js');
var path = fileUtils.path;

var codeUtils = require('../../src/analysis/ast/util/codeHierarchyUtilities');
var inputFiles;

const fixturesDirectory = path('test/fixtures/');

beforeAll(() => {

    fileUtils.removeJSONFilesFromResultDirectory('./resultFiles', []);

    var fileList = fileUtils.retrieveSourceFilesInDirectory(
        path(fixturesDirectory + 'session'), [], []);
    inputFiles = utils.retrieveModuleDefinedInFiles(fileList, [], [], './session/index.js');
});

test('retrieve module variable and functions of module', () => {

    var inputFile = findFile(inputFiles, 'session\\cookie.js');
    let projectTypeIndex = Object.values(ModuleFramework).indexOf('CommonJS');
    
    utils.processGlobalsAndFunctionsDefs(inputFile, projectTypeIndex, inputFiles);

    //functions defined in the module + 1 artifical function modelling the module's scope
    //getters/setters are also considered
    expect(inputFile.definedFunctions.length).toBe(8+1);

    expect(inputFile.explicitGlobals.length).toBe(3);
});

test('retrieve information with respect to the specific module function of module (cookie)', () => {

    var inputFile = findFile(inputFiles, 'session\\cookie.js');
    let projectTypeIndex = Object.values(ModuleFramework).indexOf('CommonJS');
    
    utils.processGlobalsAndFunctionsDefs(inputFile, projectTypeIndex, inputFiles);

    let definedFunction = inputFile.retrieveDefinedFunctionByName('Cookie');

    expect(definedFunction).not.toBe(null);
    expect(definedFunction.functionName).toBe('Cookie');
    expect(definedFunction.functionParameters.length).toBe(1);
    expect(definedFunction.functionScope).toBe(null);
    expect(definedFunction.isConstructor).toBe(true);
    expect(definedFunction.prototypeProperties.length).toBe(1);
    expect(definedFunction.functionConstructorProperties.length).toBe(4);
    expect(definedFunction.functionProperties.length).toBe(0);
    expect(definedFunction.nestedFunctions.length).toBe(0);
    expect(definedFunction.localVariables.length).toBe(0);
    expect(definedFunction.returnStatementNode).toBe(null);
});

test('retrieve information with respect to specific module function (memory)', () => {

    var inputFile = findFile(inputFiles, 'session\\memory.js');
    let projectTypeIndex = Object.values(ModuleFramework).indexOf('CommonJS');
    
    utils.processGlobalsAndFunctionsDefs(inputFile, projectTypeIndex, inputFiles);

    //functions defined in the module + 1 artifical function modelling the module's scope
    expect(inputFile.definedFunctions.length).toBe(11+1);

    let definedFunction = inputFile.retrieveDefinedFunctionByName('all');

    expect(definedFunction).not.toBe(null);
    expect(definedFunction.functionName).toBe('all');
    expect(definedFunction.functionParameters.length).toBe(1);
    expect(definedFunction.functionScope).toBe(null);
    expect(definedFunction.isConstructor).toBe(false);
    expect(definedFunction.prototypeProperties.length).toBe(0);
    expect(definedFunction.functionConstructorProperties.length).toBe(0);
    expect(definedFunction.functionProperties.length).toBe(0);
    expect(definedFunction.nestedFunctions.length).toBe(0);
    expect(definedFunction.localVariables.length).toBe(5);
    expect(definedFunction.returnStatementNode).toBe(null);
});

test('retrieve information with respect to specific module function (store)', () => {

    var inputFile = findFile(inputFiles, 'session\\store.js');
    let projectTypeIndex = Object.values(ModuleFramework).indexOf('CommonJS');
    
    utils.processGlobalsAndFunctionsDefs(inputFile, projectTypeIndex, inputFiles);

    //functions defined in the module + 1 artifical function modelling the module's scope
    expect(inputFile.definedFunctions.length).toBe(6+1);

    let definedFunction = inputFile.retrieveDefinedFunctionByName('Store');

    expect(definedFunction).not.toBe(null);
    expect(definedFunction.functionName).toBe('Store');
    expect(definedFunction.functionParameters.length).toBe(0);
    expect(definedFunction.functionScope).toBe(null);
    expect(definedFunction.isConstructor).toBe(true);
    expect(definedFunction.prototypeProperties.length).toBe(3);
    expect(definedFunction.functionConstructorProperties.length).toBe(0);
    expect(definedFunction.functionProperties.length).toBe(0);
    expect(definedFunction.nestedFunctions.length).toBe(0);
    expect(definedFunction.localVariables.length).toBe(0);
    expect(definedFunction.returnStatementNode).toBe(null);
});

test('retrieve information with respect to specific module function (index)', () => {

    var inputFile = findFile(inputFiles, '\\index.js');
    expect(inputFile).not.toBe(undefined);

    let projectTypeIndex = Object.values(ModuleFramework).indexOf('CommonJS');
    
    utils.processGlobalsAndFunctionsDefs(inputFile, projectTypeIndex, inputFiles);

    //functions defined in the module + 1 artifical function modelling the module's scope
    expect(inputFile.definedFunctions.length).toBe(32+1);

    let definedFunction = inputFile.retrieveExportedFunctionByName('session');

    expect(definedFunction).not.toBe(null);
    expect(definedFunction.functionName).toBe('session');
    expect(definedFunction.functionParameters.length).toBe(1);
    expect(definedFunction.functionScope).toBe(null);
    expect(definedFunction.isConstructor).toBe(false);
    expect(definedFunction.prototypeProperties.length).toBe(0);
    expect(definedFunction.functionConstructorProperties.length).toBe(0);

    //in a function's properties, we consider the export object's properties,
    //in the case that the function is assigned with/to the export object
    expect(definedFunction.functionProperties.length).toBe(4);

    expect(definedFunction.returnStatementNode).not.toBe(null);
});