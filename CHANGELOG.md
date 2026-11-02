## 1.7.0

+ Add support for GLPI 11 namespaced plugin classes (`GlpiPlugin\Plugin\Class`) in legacy REST API
+ Automatically encode backslashes (`%5C`) in plugin endpoints
+ Update README with GLPI 11 version compatibility notes

## 1.6.0

+ Add input parameter to `upload()` method
+ Update README.md

## 1.5.0

+ Update itemTypes.json for GLPI 9.4

## 1.4.0

+ Replace `got` module by `request-promise-native` module
+ Add `upload()` method to upload documents
+ Add `download()` method to download documents
+ Add `FileNotReadableError`, `InvalidAPIURLError` and `InvalidHTTPMethodError`
