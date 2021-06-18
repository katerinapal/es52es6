const crypto_sha256 = require('../../../../node_modules/crypto-js/sha256');
const randomPrime = require('../../../../node_modules/random-prime');

function InputFileHashMap() {

    this.size = 0;

    //[ [[key1, value1], ..., [keyn, valuen]], [[key1, value1], ... [keyn, valuen]] ]
    this.buckets = [];

    /**
     * Generates a hashmap. The number of the buckets of the generated hashmap
     * is specified by a random generated number (for preventing collisions).
     */
    this.generateHashMap = function(numOfFiles) {

        //specified randomly (prevent small hashmap with big buckets) 
        //I want a big hashmap (O(1) bucket access)) and 
        //probably constant access inside bucket (O(n))
        let hashTableSize = numOfFiles > 8 ? 
                            randomPrime.randomPrime(5*numOfFiles/8, 7*numOfFiles/8) :
                            numOfFiles;
        console.log(`Generating hashmap with ${hashTableSize} buckets.`);

        //default size of hashmap is 1 (1 2-d array)
        hashTableSize = hashTableSize === null ? 1 : hashTableSize;

        this.size = hashTableSize;

        for(let bucketIndex = 0; bucketIndex < this.size; bucketIndex++) {

            this.buckets[bucketIndex] = [];
        }
    };

    //implements the hash function computation
    this.hash = function(key) {

        //this shall be a 'bad' function (produces many collisions,
        //since file paths have similar sizes)
        //also: key.length << this.size at most cases (see generation of bucket number)
        //(many collisions expected, 
        //because each file will be added in the bucket specified by its length 
        //since key.length % this.size = key.length)
        // return key.length % this.size;

        //alt1: generate a (hopefully different!) number 
        //of each key (file absolute path) using ascii char codes
        //possible problem: file paths are similar (they might create similar ascii sums)
        // let strASCIIRes = key.split('').map(keyChar => {

        //     //int
        //     // console.log(keyChar);
        //     return keyChar.charCodeAt(0);

        // }).reduce((accumulator, currCode) => {

        //     accumulator += currCode;
        //     return accumulator;

        // }, 0);

        // // console.log(`File ${key} is hashed to bucket ${(strASCIIRes % this.size)}`);
        // return strASCIIRes % this.size;

        //alt 2: generate string from key (file absolute path) with sha1 algorithm (cryptography)
        //problem: all strings have 64 chars (collisions in buckets)
        // const hashDigest = String(crypto_sha256(key));
        // console.log(hashDigest)
        // console.log(`Hashdigest ${hashDigest.length} is hashed to bucket ${(hashDigest.length % this.size)}`);
        // return hashDigest.length % this.size;

        //alt 3: combine alts 1/2 (map each file to a sha256 code,
        //which is then mapped to a number (its char asciis))
        //sha256() returns an object
        const hashDigest = String(crypto_sha256(key));
        // console.log(hashDigest)
        let strASCIIRes = hashDigest.split('').map(keyChar => {

            //int
            // console.log(keyChar);
            return keyChar.charCodeAt(0);

        }).reduce((accumulator, currCode) => {

            accumulator += currCode;
            return accumulator;

        }, 0);

        //useful for debugging
        // console.log(`File ${key} is hashed to bucket ${(strASCIIRes % this.size)}`);
        return strASCIIRes % this.size;
    };

    //introduces the input file pointed by (key, value)
    //to the hash table
    this.introduceInputFileToMap = function(key, value) {

        let hashIndex = this.hash(key);

        //add pair (key, value) to list
        this.buckets[hashIndex].push([key, value]);
    };

    /**
     * Retrieves and returns the inputFile pointed by key from the hash table
     * @param {*} key the file's key
     * @returns the file if exists, null otherwise.
     */
    this.retrieveInputFileInMap = function(key) {

        let hashIndex = this.hash(key);

        // console.log(`Resolving ${key} in input file hash map.`);
        // console.log(`#Files in bucket ${hashIndex}: ${this.buckets[hashIndex].length}`);
        let inputFile = this.buckets[hashIndex].find(inputFilePair => {

            // console.log(inputFilePair[0]);
            return inputFilePair[0] === key;
        });

        //return the input file
        //this.buckets[hashIndex] is an array of [key,value] elements
        return inputFile == undefined ? null : inputFile[1];
    };

    /**
     * Removes the inputFile pointed by key from the hash table
     * @param {*} key the file's key
     * @returns true if file is deleted, false otherwise
     */
    this.removeInputFileFromMap = function(key) {

        let hashIndex = this.hash(key);

        //maybe optimize with findIndex()/splice()
        //find input file by its key in hashmap (rerieve its index)
        let fileIndex = this.buckets[hashIndex].findIndex(inputFilePair => {

            return inputFilePair.key === key;
        });

        if(fileIndex === -1) {

            return false;
        }

        //remove file with fileIndex from the bucket array
        //removes the specified number of elements starting from the position fileIndex
        let removedFiles = this.buckets[hashIndex].splice(fileIndex, 1);

        if(removedFiles.length === 0) {

            return false;
        }

        console.log('Removed file from hashmap.');
        return true;
    };

    /**
     * Converts input file hash map to an array of input file objects.
     */
    this.convertHashMapToArray = function() {

        //this.buckets: array with arrays
        //map result: array with arrays of inputFile objects
        //reduce result: array with inputFile objects
        let inputFileArray = this.buckets.map(fileList => {

            //fileList: array with file objects [key, value]
            return fileList.map(fileObj => {

                return fileObj[1];
            });

        }).reduce((accumulator, currFileArr) => {

            accumulator = accumulator.concat(currFileArr);
            return accumulator;
        }, []);

        return inputFileArray;
    };

    //prints the hashmap's files (for debugging purposes)
    this.printInputFiles = function() {

        console.log('HashMap size: ' + this.size + '\n');

        this.buckets.forEach((fileList, bucketIndex) => {

            console.log('Bucket ' + bucketIndex + ': ');
            fileList.forEach(inputFileArray => {

                //input files are stored in arrays of form [key, value]
                //key: the file's absolute path
                //value: the object bundling information with respect to file
                console.log(inputFileArray[1]);
            });

            console.log();
        });
    };

    /**
     * Prints the hashmap's bucket sizes 
     * (for debugging w.r.t file distribution - useful for retrievals).
     */
    this.printBucketStats = function() {

        this.buckets.forEach((fileList, bucketIndex) => {

            console.log(`#Files in bucket ${bucketIndex}: ${fileList.length}.`);
        });
    };
};

exports.InputFileHashMap = InputFileHashMap;