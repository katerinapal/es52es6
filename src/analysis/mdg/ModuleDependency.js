/**
 * http://usejsdoc.org/
 */

let ModuleDependency = {
	FunctionDefinition: 'FunctionDefinition', 
	GlobalUse: 'GlobalUse',
	GlobalDefinition: 'GlobalDefinition',
	NamespaceImport: 'NamespaceImport',
	NamespaceModification: 'NamespaceModification',
	ModuleImport: 'ModuleImport',
	ImpliedGlobalImport: 'ImpliedGlobalImport',
	ImpliedGlobalDefinition: 'ImpliedGlobalDefinition',
	ImpliedGlobalModification: 'ImpliedGlobalModification',
	GlobalObjectPropertyDefinition: 'GlobalObjectPropertyDefinition',
	GlobalObjectPropertyUse: 'GlobalObjectPropertyUse',
	GlobalObjectPropertyModification: 'GlobalObjectPropertyModification'
};
Object.freeze(ModuleDependency);

exports.ModuleDependency = ModuleDependency;
