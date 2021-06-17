const projectUtils = require('../util/project-utils')
const findFile = projectUtils.findFile;
const utils = require('../../src/analysis/ast/util/util.js');
const ModuleFramework = require('../../src/analysis/ast/util/enums.js').ModuleFramework;
const fileUtils = require('../../src/io/fileUtilities.js');

var path = fileUtils.path;

var inputFiles;

const fixturesDirectory = path('test/fixtures/');

const metricUtilities = require('../../src/analysis/metrics/metricUtilities.js');

beforeAll(() => {

    fileUtils.removeJSONFilesFromResultDirectory('./resultFiles', []);

    //before retrieving the imported declarations of each module,
    //the code hierarchy of each project's module is resolved
    var fileList = fileUtils.retrieveSourceFilesInDirectory(path(fixturesDirectory + 'session'), [], []);
    inputFiles = utils.retrieveModuleDefinedInFiles(fileList, [], [], './session/index.js');

    let projectTypeIndex = Object.values(ModuleFramework).indexOf('CommonJS');

    inputFiles.buckets.forEach(bucket => {

        bucket.forEach(inputFileArray => {

            //all input file hashmap entries are modelled in 2-slot arrays
            //first element: the input file's absolute path (impacts the result of the hash function)
            //second element: the object keeping full information with respect to the file
            let inputFile = inputFileArray[1];

            utils.processGlobalsAndFunctionsDefs(inputFile, projectTypeIndex, inputFiles);
        });

    });

});

test('retrieve the number of the declarations imported in specific module (cookie)', () => {

    var inputFile = findFile(inputFiles, 'session\\cookie.js');

    metricUtilities.retrieveImportedGlobalsOfModule(inputFiles, inputFile);
    
    //variables imported through dot notation right after the invocation of require()
    let importedVariables = inputFile.importedVariables;

    //functions imported through dot notation right after the invocation of require()
    let importedFunctions = inputFile.importedFunctions;

    //namespaces returned as results of invocations of require()
    let importedNamespaces = inputFile.importedNamespaces;

    //modules imported for their side-effects (results of the invocations of require() that are not assigned to a variable)
    let importedModules = inputFile.importedModules;

    expect(importedVariables.length).toBe(0);
    expect(importedFunctions.length).toBe(0);
    expect(importedNamespaces.length).toBe(2);
    expect(importedModules.length).toBe(0);
});

test('retrieve the number of the declarations imported in specific module (memory)', () => {

    var inputFile = findFile(inputFiles, 'session\\memory.js');

    metricUtilities.retrieveImportedGlobalsOfModule(inputFiles, inputFile);
    
    //variables imported through dot notation right after the invocation of require()
    let importedVariables = inputFile.importedVariables;

    //functions imported through dot notation right after the invocation of require()
    let importedFunctions = inputFile.importedFunctions;

    //namespaces returned as results of invocations of require()
    let importedNamespaces = inputFile.importedNamespaces;

    //modules imported for their side-effects (results of the invocations of require() that are not assigned to a variable)
    let importedModules = inputFile.importedModules;

    expect(importedVariables.length).toBe(0);
    expect(importedFunctions.length).toBe(0);
    expect(importedNamespaces.length).toBe(2);
    expect(importedModules.length).toBe(0);
});

test('retrieve the number of the declarations exported from specific module (cookie)', () => {

    var inputFile = findFile(inputFiles, 'session\\cookie.js');

    metricUtilities.retrieveExportedElementsOfModule(inputFile, inputFiles);
    
    //variables assigned/bound to exports/module.exports
    let exportedVariables = inputFile.retrieveExportedVariables();

    //functions assigned/bound to exports/module.exports
    let exportedFunctions = inputFile.retrieveExportedFunctions();

    //values/objects directly assigned/bound to exports/module.exports
    let exportedProperties = inputFile.exportedProperties;

    //functions assigned to variables considered in exportedVariables
    expect(exportedVariables.length).toBe(1);
    expect(exportedFunctions.length).toBe(0);
    expect(exportedProperties.length).toBe(0);

    let exportedVariable = exportedVariables[0];
    let exportedVariableLoc = exportedVariable.exportedVariableNode.loc;
    expect(exportedVariable.variableName).toBe('Cookie');

    //the exported variable's is the whole variable declaration
    expect(exportedVariableLoc.start).toStrictEqual({line: 25, column: 0});
    expect(exportedVariableLoc.end).toStrictEqual({line: 33, column: 2});

    expect(exportedVariable.isElementExportedViaModuleExports).toBe(true);
});

test('retrieve the number of the declarations exported from specific module (memory)', () => {

    var inputFile = findFile(inputFiles, 'session\\memory.js');

    metricUtilities.retrieveExportedElementsOfModule(inputFile, inputFiles);
    
    //variables assigned/bound to exports/module.exports
    let exportedVariables = inputFile.retrieveExportedVariables();

    //functions assigned/bound to exports/module.exports
    let exportedFunctions = inputFile.retrieveExportedFunctions();

    //values/objects directly assigned/bound to exports/module.exports
    let exportedProperties = inputFile.exportedProperties;

    expect(exportedVariables.length).toBe(0);
    expect(exportedFunctions.length).toBe(1);
    expect(exportedProperties.length).toBe(0);

    let exportedFunction = exportedFunctions[0];
    let exportedFunctionNodeLoc = exportedFunction.functionNode.loc;
    expect(exportedFunctions[0].functionName).toBe('MemoryStore');
    expect(exportedFunctionNodeLoc.start).toStrictEqual({line: 40, column: 0});
    expect(exportedFunctionNodeLoc.end).toStrictEqual({line: 43, column: 1});

    expect(exportedFunction.isElementExportedViaModuleExports).toBe(true);
    expect(exportedFunction.isFunctionConstructor).toBe(true);
});