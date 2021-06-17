const projectUtils = require('../util/project-utils');
const findFile = projectUtils.findFile;
const utils = require('../../src/analysis/ast/util/util.js');
const ModuleFramework = require('../../src/analysis/ast/util/enums.js').ModuleFramework;
const fileUtils = require('../../src/io/fileUtilities.js');
var path = fileUtils.path;

var inputFiles;
var mdg;

const fixturesDirectory = path('test/fixtures/');

const metricUtilities = require('../../src/analysis/metrics/metricUtilities.js');
const mdgUtilities = require('../../src/analysis/mdg/mdgUtilities.js');

beforeAll(() => {

    fileUtils.removeJSONFilesFromResultDirectory('./resultFiles', []);

    //before retrieving the imported declarations of each module,
    //the code hierarchy of each project's module is resolved
    //also, fully exclude configuration JS files from analysis
    var fileList = fileUtils.retrieveSourceFilesInDirectory(path(fixturesDirectory + 'session'), [], []);
    inputFiles = utils.retrieveModuleDefinedInFiles(fileList, [], [], './session/index.js');

    let projectTypeIndex = Object.values(ModuleFramework).indexOf('CommonJS');

    //retrieve module variables and functions of each module
    inputFiles.buckets.forEach(bucket => {

        bucket.forEach(inputFileArray => {

            //all input file hashmap entries are modelled in 2-slot arrays
            //first element: the input file's absolute path (impacts the result of the hash function)
            //second element: the object keeping full information with respect to the file
            let inputFile = inputFileArray[1];

            utils.processGlobalsAndFunctionsDefs(inputFile, projectTypeIndex, inputFiles, [], []);
        });

    });

    //retrieve imported declarations of each module (after code hierarchy is generated for all modules)
    inputFiles.buckets.forEach(bucket => {

        bucket.forEach(inputFileArray => {

            //all input file hashmap entries are modelled in 2-slot arrays
            //first element: the input file's absolute path (impacts the result of the hash function)
            //second element: the object keeping full information with respect to the file
            let inputFile = inputFileArray[1];

            metricUtilities.retrieveImportedGlobalsOfModule(inputFiles, inputFile);
        });

    });

    //construct the MDG of the analysed project
    mdg = mdgUtilities.createMDG(inputFiles);
});

test('compute the nodes of the MDG', () => {

    expect(mdg.nodeList.length).toBe(6);
});

test('compute the adjacent MDG nodes of specific module (session\\cookie)', () => {

    var inputFile = findFile(inputFiles, 'session\\cookie.js');
    var mdgNode = mdg.retrieveMDGNodeRepresentingModule(inputFile);

    expect(mdgNode.adjacencyList.length).toBe(2);

    //assuming the adjacent modules located in npm packages
    let localAdjacentModules = mdgNode.adjacencyList.filter(adjacentMDGNode => {

        return adjacentMDGNode.node !== 'externalModule';
    });

    expect(localAdjacentModules.length).toBe(0);
    
});

test('compute the adjacent MDG nodes of specific module (session\\memory)', () => {

    var inputFile = findFile(inputFiles, 'session\\memory.js');
    var mdgNode = mdg.retrieveMDGNodeRepresentingModule(inputFile);

    expect(mdgNode.adjacencyList.length).toBe(2);

    //assuming the adjacent modules that are located in npm packages
    let localAdjacentModules = mdgNode.adjacencyList.filter(adjacentMDGNode => {

        return adjacentMDGNode.node !== 'externalModule';
    });

    expect(localAdjacentModules.length).toBe(1);
    
    let localAdjacentModule = localAdjacentModules[0];
    let adjacentFile = findFile(inputFiles, localAdjacentModule.node.representedModule.fileName);
    expect(adjacentFile.fileName).toMatch('\\session\\session\\store.js');

    let moduleDependency = localAdjacentModule.moduleDependency;
    expect(moduleDependency.edgeType).toBe('NamespaceImport');
    expect(moduleDependency.usageSet.length).toBe(2);
});

test('compute the adjacent MDG nodes of specific module (session\\session)', () => {

    var inputFile = findFile(inputFiles, 'session\\session.js');
    var mdgNode = mdg.retrieveMDGNodeRepresentingModule(inputFile);

    expect(mdgNode.adjacencyList.length).toBe(0);

});

test('compute the adjacent MDG nodes of specific module (session\\store)', () => {

    var inputFile = findFile(inputFiles, 'session\\store.js');
    var mdgNode = mdg.retrieveMDGNodeRepresentingModule(inputFile);

    expect(mdgNode.adjacencyList.length).toBe(4);

    //assuming the adjacent modules that are located in npm packages
    let localAdjacentModules = mdgNode.adjacencyList.filter(adjacentMDGNode => {

        return adjacentMDGNode.node !== 'externalModule';
    });

    expect(localAdjacentModules.length).toBe(2);

    let localAdjacentModule = localAdjacentModules[0];
    let adjacentFile = findFile(inputFiles, localAdjacentModule.node.representedModule.fileName);
    expect(adjacentFile.fileName).toMatch('\\session\\session\\cookie.js');
    
    let moduleDependency = localAdjacentModule.moduleDependency;
    expect(moduleDependency.edgeType).toBe('NamespaceImport');
    expect(moduleDependency.usageSet.length).toBe(1);
});

test('compute the adjacent MDG nodes of specific module (test\\session)', () => {

    var inputFile = findFile(inputFiles, 'test\\session.js');
    var mdgNode = mdg.retrieveMDGNodeRepresentingModule(inputFile);

    //index.js not introduced in fixtures/ (1 dependency less)
    expect(mdgNode.adjacencyList.length).toBe(11);

    //assuming the adjacent modules that are located in npm packages
    let localAdjacentModules = mdgNode.adjacencyList.filter(adjacentMDGNode => {

        return adjacentMDGNode.node !== 'externalModule';
    });

    expect(localAdjacentModules.length).toBe(2);

    let localAdjacentModule = localAdjacentModules[1];
    let adjacentFile = findFile(inputFiles, localAdjacentModule.node.representedModule.fileName);
    expect(adjacentFile.fileName).toMatch('\\session\\session\\cookie.js');
    
    let moduleDependency = localAdjacentModule.moduleDependency;
    expect(moduleDependency.edgeType).toBe('NamespaceImport');
    expect(moduleDependency.usageSet.length).toBe(1);
});