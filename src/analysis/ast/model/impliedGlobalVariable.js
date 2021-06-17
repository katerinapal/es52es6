/**
 * ImpliedGlobalVariable.js. Models the variables that are assigned a value without being defined.
 */

var jscodeshift = require('../../../../node_modules/jscodeshift');

function ImpliedGlobalVariable(variableName) {

    this.variableName = variableName;

    //AST node representing the statement whose execution results in the creation of the implied global variable
    this.creationStatement = null;
    this.updateCreationStatement = function(creationStatement) {

        this.creationStatement = creationStatement;
    };

    /**
     * References of implied global within its definition module
     * (resolved during analysis).
     * Definition module is not determined during analysis, but 
     * right before the refactoring through an MDG traversal 
     * (the module with the minimum fan-out).
     */
    this.elementUsages = [];
    this.updateElementUsages = function(elementUsages) {

        this.elementUsages = elementUsages;
    }

    this.isAssigned = false;
    this.updateIsAssigned = function() {

        //assignments of implied globals:
        //(a) update expressions
        //(b) assignments
        //(c) iteration loops
        //(update-d) return statement (or other statements) with assignment expression
        // console.log(this.creationStatement)

        //(a)-(b)
        if(this.creationStatement.value.type === 'ExpressionStatement') {

            //(a)
            if(this.creationStatement.value.expression.type === 'UpdateExpression') {

                this.isAssigned = true;
                return;
            }
    
            //(b)
            if(this.creationStatement.value.expression.type === 'AssignmentExpression') {
    
                //(i) plain assignments (e.g. a = ...)
                //(ii) chain assignments (e.g. a = b = ...)

                // console.log(this.creationStatement.value.expression);
    
                //(i)
                if(this.creationStatement.value.expression.left.type === 'Identifier' &&
                    this.creationStatement.value.expression.left.name === this.variableName) {
    
                    this.isAssigned = true;
                    return;
                }
    
                //(ii)
                let assignmentAST = jscodeshift(this.creationStatement);
                let assignmentsIntroducingImplied = assignmentAST.find(jscodeshift.AssignmentExpression).filter(assignment => {
    
                    return assignment.value.left.type === 'Identifier' && 
                            assignment.value.left.name === this.variableName;
                });
    
                if(assignmentsIntroducingImplied.length > 0) {
    
                    this.isAssigned = true;
                    return;
                }
    
                return;
            }

            return;
        }
        
        //(c)
        //(i) for loops
        if(this.creationStatement.value.type.startsWith('For') === true) {

            //(1) classic for
            if(this.creationStatement.value.type === 'ForStatement') {

                let initExpression = this.creationStatement.value.init;
                if(initExpression === null) {

                    return;
                }

                if(initExpression.type === 'AssignmentExpression' &&
                    initExpression.left.type === 'Identifier' &&
                    initExpression.left.name === this.variableName) {

                    this.isAssigned = true;
                    return;
                }

                //multiple initializations in for loop
                //find the assignment that introduces implied global (assigns a value to it)
                if(initExpression.type === 'SequenceExpression') {

                    let initAssignments = initExpression.expressions.filter(initAssignment => {

                        //plain assignments
                        if(initAssignment.left.type === 'Identifier' &&
                            initAssignment.left.name === this.variableName) {

                            return true;
                        }

                        //chain assignments
                        let assignmentsIntroducingImplied = jscodeshift(initAssignment).find(jscodeshift.AssignmentExpression).filter(intAssignment => {

                            return intAssignment.value.left.type === 'Identifier' &&
                                    intAssignment.value.left.name === this.variableName;
                        });

                        if(assignmentsIntroducingImplied.length > 0) {

                            return true;
                        }

                        return false;
                    });

                    if(initAssignments.length > 0) {

                        this.isAssigned = true;
                        return;
                    }
                }

                return;
            }

            //(2) language-specific for loops (for/in, for/of)
            if(this.creationStatement.value.type === 'ForInStatement' ||
                this.creationStatement.value.type === 'ForOfStatement') {

                if(this.creationStatement.value.left.type === 'Identifier' &&
                    this.creationStatement.value.left.name === this.variableName) {

                    this.isAssigned = true;
                    return;
                }

                return;
            }

            return;
        }

        //(ii) while, do/while loops
        if(this.creationStatement.value.type === 'WhileStatement' ||
            this.creationStatement.value.type === 'DoWhileStatement') {

            let testExpression = this.creationStatement.value.test;
            if(testExpression.type === null) {

                return;
            }

            //testExpression includes 1..n binary expressions
            //1
            if(testExpression.type === 'BinaryExpression' &&
                testExpression.operator === 'in' &&
                testExpression.left.type === 'Identifier' && 
                testExpression.left.name === this.variableName) {

                this.isAssigned = true;
                return;
            }

            //n>1
            if(testExpression.type === 'LogicalExpression') {

                let exprAST = jscodeshift(testExpression);
                let binaryExprIntroducingImplied = exprAST.find(jscodeshift.BinaryExpression).filter(binaryExp => {

                    return binaryExp.value.operator === 'in' &&
                            binaryExp.value.left.type === 'Identifier' && 
                            binaryExp.value.left.name === this.variableName;
                });

                if(binaryExprIntroducingImplied.length > 0) {

                    this.isAssigned = true;
                    return;
                }

                return;
            }

            return;
        }

        //(d)
        let assignmentExps = jscodeshift(this.creationStatement).find(jscodeshift.AssignmentExpression).filter(assignmentExp => {

            return assignmentExp.value.left.type === 'Identifier' &&
                    assignmentExp.value.left.name === this.variableName;
        });

        if(assignmentExps.length > 0) {

            this.isAssigned = true;
        }
    };

    this.isDefined = false;
    this.updateIsDefined = function(isDefined) {

        this.isDefined = isDefined;
    };

    this.isMappedToExportedDefinitions = function() {

        return true;
    };

    this.isMappedToImportedAndReexportedDefinitions = function() {

        return false;
    };

    this.mappedToObjectWithPropertiesInitializedWithImportedDefs = function() {

        return false;
    };

    this.numberDefinitionsExportedFromVariable = function() {

        return 1;
    };

    //equality comparison function (prevents adding the same implied global more than once,
    //in cases where the same implied global is used in different code segments)
    this.compare = function(impliedGlobalVariable) {

        if(this.variableName === impliedGlobalVariable.variableName) {

            return true;
        }

        return false;
    };
};

exports.ImpliedGlobalVariable = ImpliedGlobalVariable;