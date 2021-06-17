/**
 * Finds a file in the hashmap. The file is searched by part of its path.
 * @param {InputHashMap} inputFileMap The input hashmap with file names and asts
 * @param {string} name Requested file
 */
function findFile(inputFileMap, name) {
    
    var result = inputFileMap.buckets
        .reduce( (sum, item) => sum.concat(item), [])
        .map(entry => entry[1])
        .filter(ast => ast.fileName.indexOf(name) != -1);
    //console.log(flatArray.length);

    if (result.length >= 1){
        return result[0];
    }
    return undefined;
}

function getProjectTypeIndex(framework) {
    return Object.values(ModuleFramework).indexOf(framework);
}


module.exports.findFile = findFile;