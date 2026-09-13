# Executes only safe probe helpers extracted from this repository's installer AST.
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../../install-local.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Installer does not parse'}
foreach($name in @('Native-Probe','Checked')) {
  $fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  if(!$fn){throw "Missing function $name"}
  . ([scriptblock]::Create($fn.Extent.Text))
}
if(!(Native-Probe 'cmd.exe' @('/c','exit 0'))){throw 'Successful native probe rejected'}
if(Native-Probe 'cmd.exe' @('/c','echo Expected failure 1>&2 & exit /b 9')){throw 'Failed native probe accepted'}
if($ErrorActionPreference -ne 'Stop'){throw 'Probe leaked preference change'}
Checked 'cmd.exe' @('/c','exit 0')
$failed=$false
try {Checked 'cmd.exe' @('/c','exit 9')}catch{$failed=$true}
if(!$failed){throw 'Nonzero command did not fail'}
Write-Output 'Windows native command success/failure boundaries: PASS'
