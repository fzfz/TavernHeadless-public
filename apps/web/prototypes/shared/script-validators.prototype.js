var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// ../TavernHeadless/node_modules/.pnpm/ajv@8.17.1/node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "../TavernHeadless/node_modules/.pnpm/ajv@8.17.1/node_modules/ajv/dist/runtime/ucs2length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// <stdin>
var packageSchema = validate11;
var schema12 = { "type": "object", "properties": { "apiVersion": { "const": 1 }, "html": { "type": "string", "minLength": 1 }, "css": { "type": "string", "minLength": 1 }, "script": { "type": "string", "minLength": 1 }, "assets": { "type": "object", "additionalProperties": { "type": "object", "properties": { "kind": { "enum": ["image", "audio"] }, "file": { "type": "string", "minLength": 1 }, "label": { "type": "string", "minLength": 1 }, "tags": { "type": "array", "items": { "type": "string", "minLength": 1 }, "uniqueItems": true } }, "required": ["kind", "file", "label", "tags"], "additionalProperties": false }, "propertyNames": { "type": "string", "minLength": 1 } }, "data": { "type": "object", "additionalProperties": true }, "floorHtml": { "type": "string", "minLength": 1 } }, "required": ["apiVersion", "html", "css", "script", "assets", "data"], "additionalProperties": false };
var func2 = require_ucs2length().default;
function validate11(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.apiVersion === void 0 && (missing0 = "apiVersion") || data.html === void 0 && (missing0 = "html") || data.css === void 0 && (missing0 = "css") || data.script === void 0 && (missing0 = "script") || data.assets === void 0 && (missing0 = "assets") || data.data === void 0 && (missing0 = "data")) {
        validate11.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "apiVersion" || key0 === "html" || key0 === "css" || key0 === "script" || key0 === "assets" || key0 === "data" || key0 === "floorHtml")) {
            validate11.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.apiVersion !== void 0) {
            const _errs2 = errors;
            if (1 !== data.apiVersion) {
              validate11.errors = [{ instancePath: instancePath + "/apiVersion", schemaPath: "#/properties/apiVersion/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" }];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.html !== void 0) {
              let data1 = data.html;
              const _errs3 = errors;
              if (errors === _errs3) {
                if (typeof data1 === "string") {
                  if (func2(data1) < 1) {
                    validate11.errors = [{ instancePath: instancePath + "/html", schemaPath: "#/properties/html/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                } else {
                  validate11.errors = [{ instancePath: instancePath + "/html", schemaPath: "#/properties/html/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.css !== void 0) {
                let data2 = data.css;
                const _errs5 = errors;
                if (errors === _errs5) {
                  if (typeof data2 === "string") {
                    if (func2(data2) < 1) {
                      validate11.errors = [{ instancePath: instancePath + "/css", schemaPath: "#/properties/css/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                      return false;
                    }
                  } else {
                    validate11.errors = [{ instancePath: instancePath + "/css", schemaPath: "#/properties/css/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                    return false;
                  }
                }
                var valid0 = _errs5 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.script !== void 0) {
                  let data3 = data.script;
                  const _errs7 = errors;
                  if (errors === _errs7) {
                    if (typeof data3 === "string") {
                      if (func2(data3) < 1) {
                        validate11.errors = [{ instancePath: instancePath + "/script", schemaPath: "#/properties/script/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                        return false;
                      }
                    } else {
                      validate11.errors = [{ instancePath: instancePath + "/script", schemaPath: "#/properties/script/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                      return false;
                    }
                  }
                  var valid0 = _errs7 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.assets !== void 0) {
                    let data4 = data.assets;
                    const _errs9 = errors;
                    if (errors === _errs9) {
                      if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
                        for (const key1 in data4) {
                          const _errs11 = errors;
                          if (errors === _errs11) {
                            if (typeof key1 === "string") {
                              if (func2(key1) < 1) {
                                const err0 = { instancePath: instancePath + "/assets", schemaPath: "#/properties/assets/propertyNames/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters", propertyName: key1 };
                                if (vErrors === null) {
                                  vErrors = [err0];
                                } else {
                                  vErrors.push(err0);
                                }
                                errors++;
                              }
                            } else {
                              const err1 = { instancePath: instancePath + "/assets", schemaPath: "#/properties/assets/propertyNames/type", keyword: "type", params: { type: "string" }, message: "must be string", propertyName: key1 };
                              if (vErrors === null) {
                                vErrors = [err1];
                              } else {
                                vErrors.push(err1);
                              }
                              errors++;
                            }
                          }
                          var valid1 = _errs11 === errors;
                          if (!valid1) {
                            const err2 = { instancePath: instancePath + "/assets", schemaPath: "#/properties/assets/propertyNames", keyword: "propertyNames", params: { propertyName: key1 }, message: "property name must be valid" };
                            if (vErrors === null) {
                              vErrors = [err2];
                            } else {
                              vErrors.push(err2);
                            }
                            errors++;
                            validate11.errors = vErrors;
                            return false;
                            break;
                          }
                        }
                        if (valid1) {
                          for (const key2 in data4) {
                            let data5 = data4[key2];
                            const _errs14 = errors;
                            if (errors === _errs14) {
                              if (data5 && typeof data5 == "object" && !Array.isArray(data5)) {
                                let missing1;
                                if (data5.kind === void 0 && (missing1 = "kind") || data5.file === void 0 && (missing1 = "file") || data5.label === void 0 && (missing1 = "label") || data5.tags === void 0 && (missing1 = "tags")) {
                                  validate11.errors = [{ instancePath: instancePath + "/assets/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/assets/additionalProperties/required", keyword: "required", params: { missingProperty: missing1 }, message: "must have required property '" + missing1 + "'" }];
                                  return false;
                                } else {
                                  const _errs16 = errors;
                                  for (const key3 in data5) {
                                    if (!(key3 === "kind" || key3 === "file" || key3 === "label" || key3 === "tags")) {
                                      validate11.errors = [{ instancePath: instancePath + "/assets/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/assets/additionalProperties/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" }];
                                      return false;
                                      break;
                                    }
                                  }
                                  if (_errs16 === errors) {
                                    if (data5.kind !== void 0) {
                                      let data6 = data5.kind;
                                      const _errs17 = errors;
                                      if (!(data6 === "image" || data6 === "audio")) {
                                        validate11.errors = [{ instancePath: instancePath + "/assets/" + key2.replace(/~/g, "~0").replace(/\//g, "~1") + "/kind", schemaPath: "#/properties/assets/additionalProperties/properties/kind/enum", keyword: "enum", params: { allowedValues: schema12.properties.assets.additionalProperties.properties.kind.enum }, message: "must be equal to one of the allowed values" }];
                                        return false;
                                      }
                                      var valid3 = _errs17 === errors;
                                    } else {
                                      var valid3 = true;
                                    }
                                    if (valid3) {
                                      if (data5.file !== void 0) {
                                        let data7 = data5.file;
                                        const _errs18 = errors;
                                        if (errors === _errs18) {
                                          if (typeof data7 === "string") {
                                            if (func2(data7) < 1) {
                                              validate11.errors = [{ instancePath: instancePath + "/assets/" + key2.replace(/~/g, "~0").replace(/\//g, "~1") + "/file", schemaPath: "#/properties/assets/additionalProperties/properties/file/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                              return false;
                                            }
                                          } else {
                                            validate11.errors = [{ instancePath: instancePath + "/assets/" + key2.replace(/~/g, "~0").replace(/\//g, "~1") + "/file", schemaPath: "#/properties/assets/additionalProperties/properties/file/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                            return false;
                                          }
                                        }
                                        var valid3 = _errs18 === errors;
                                      } else {
                                        var valid3 = true;
                                      }
                                      if (valid3) {
                                        if (data5.label !== void 0) {
                                          let data8 = data5.label;
                                          const _errs20 = errors;
                                          if (errors === _errs20) {
                                            if (typeof data8 === "string") {
                                              if (func2(data8) < 1) {
                                                validate11.errors = [{ instancePath: instancePath + "/assets/" + key2.replace(/~/g, "~0").replace(/\//g, "~1") + "/label", schemaPath: "#/properties/assets/additionalProperties/properties/label/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                                return false;
                                              }
                                            } else {
                                              validate11.errors = [{ instancePath: instancePath + "/assets/" + key2.replace(/~/g, "~0").replace(/\//g, "~1") + "/label", schemaPath: "#/properties/assets/additionalProperties/properties/label/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                              return false;
                                            }
                                          }
                                          var valid3 = _errs20 === errors;
                                        } else {
                                          var valid3 = true;
                                        }
                                        if (valid3) {
                                          if (data5.tags !== void 0) {
                                            let data9 = data5.tags;
                                            const _errs22 = errors;
                                            if (errors === _errs22) {
                                              if (Array.isArray(data9)) {
                                                var valid4 = true;
                                                const len0 = data9.length;
                                                for (let i0 = 0; i0 < len0; i0++) {
                                                  let data10 = data9[i0];
                                                  const _errs24 = errors;
                                                  if (errors === _errs24) {
                                                    if (typeof data10 === "string") {
                                                      if (func2(data10) < 1) {
                                                        validate11.errors = [{ instancePath: instancePath + "/assets/" + key2.replace(/~/g, "~0").replace(/\//g, "~1") + "/tags/" + i0, schemaPath: "#/properties/assets/additionalProperties/properties/tags/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                                        return false;
                                                      }
                                                    } else {
                                                      validate11.errors = [{ instancePath: instancePath + "/assets/" + key2.replace(/~/g, "~0").replace(/\//g, "~1") + "/tags/" + i0, schemaPath: "#/properties/assets/additionalProperties/properties/tags/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                                      return false;
                                                    }
                                                  }
                                                  var valid4 = _errs24 === errors;
                                                  if (!valid4) {
                                                    break;
                                                  }
                                                }
                                                if (valid4) {
                                                  let i1 = data9.length;
                                                  let j0;
                                                  if (i1 > 1) {
                                                    const indices0 = {};
                                                    for (; i1--; ) {
                                                      let item0 = data9[i1];
                                                      if (typeof item0 !== "string") {
                                                        continue;
                                                      }
                                                      if (typeof indices0[item0] == "number") {
                                                        j0 = indices0[item0];
                                                        validate11.errors = [{ instancePath: instancePath + "/assets/" + key2.replace(/~/g, "~0").replace(/\//g, "~1") + "/tags", schemaPath: "#/properties/assets/additionalProperties/properties/tags/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" }];
                                                        return false;
                                                        break;
                                                      }
                                                      indices0[item0] = i1;
                                                    }
                                                  }
                                                }
                                              } else {
                                                validate11.errors = [{ instancePath: instancePath + "/assets/" + key2.replace(/~/g, "~0").replace(/\//g, "~1") + "/tags", schemaPath: "#/properties/assets/additionalProperties/properties/tags/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                                                return false;
                                              }
                                            }
                                            var valid3 = _errs22 === errors;
                                          } else {
                                            var valid3 = true;
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              } else {
                                validate11.errors = [{ instancePath: instancePath + "/assets/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/assets/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                return false;
                              }
                            }
                            var valid2 = _errs14 === errors;
                            if (!valid2) {
                              break;
                            }
                          }
                        }
                      } else {
                        validate11.errors = [{ instancePath: instancePath + "/assets", schemaPath: "#/properties/assets/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                        return false;
                      }
                    }
                    var valid0 = _errs9 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.data !== void 0) {
                      let data11 = data.data;
                      const _errs26 = errors;
                      if (errors === _errs26) {
                        if (data11 && typeof data11 == "object" && !Array.isArray(data11)) {
                        } else {
                          validate11.errors = [{ instancePath: instancePath + "/data", schemaPath: "#/properties/data/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                          return false;
                        }
                      }
                      var valid0 = _errs26 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.floorHtml !== void 0) {
                        let data12 = data.floorHtml;
                        const _errs29 = errors;
                        if (errors === _errs29) {
                          if (typeof data12 === "string") {
                            if (func2(data12) < 1) {
                              validate11.errors = [{ instancePath: instancePath + "/floorHtml", schemaPath: "#/properties/floorHtml/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                              return false;
                            }
                          } else {
                            validate11.errors = [{ instancePath: instancePath + "/floorHtml", schemaPath: "#/properties/floorHtml/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                            return false;
                          }
                        }
                        var valid0 = _errs29 === errors;
                      } else {
                        var valid0 = true;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate11.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate11.errors = vErrors;
  return errors === 0;
}
var record = validate12;
var schema14 = { "type": "object", "properties": { "sessionId": { "type": "string", "minLength": 1 }, "branchId": { "type": "string", "minLength": 1 }, "floorId": { "type": ["string", "null"], "minLength": 1 }, "attemptId": { "type": ["string", "null"], "minLength": 1 }, "versionId": { "type": "string", "minLength": 1 }, "snapshotId": { "type": "string", "minLength": 1 }, "parentSnapshotId": { "type": ["string", "null"], "minLength": 1 }, "variables": { "type": "object", "additionalProperties": true }, "source": { "$ref": "#/definitions/snapshotSource" } }, "required": ["sessionId", "branchId", "floorId", "attemptId", "versionId", "snapshotId", "parentSnapshotId", "variables", "source"], "additionalProperties": false, "oneOf": [{ "properties": { "floorId": { "type": "null" }, "attemptId": { "type": "null" }, "parentSnapshotId": { "type": "null" }, "source": { "type": "object", "properties": { "kind": { "enum": ["initial"] } } } } }, { "properties": { "floorId": { "type": "string", "minLength": 1 }, "attemptId": { "type": "string", "minLength": 1 }, "parentSnapshotId": { "type": "string", "minLength": 1 }, "source": { "type": "object", "properties": { "kind": { "enum": ["floor", "job"] } } } } }, { "properties": { "source": { "type": "object", "properties": { "kind": { "enum": ["manual"] } } } }, "oneOf": [{ "properties": { "floorId": { "type": "null" }, "attemptId": { "type": "null" }, "parentSnapshotId": { "type": "null" } } }, { "properties": { "floorId": { "type": "string", "minLength": 1 }, "attemptId": { "type": "string", "minLength": 1 }, "parentSnapshotId": { "type": "string", "minLength": 1 } } }] }] };
var schema15 = { "oneOf": [{ "type": "object", "properties": { "kind": { "const": "initial" }, "runId": { "type": "null" }, "jobId": { "type": "null" } }, "required": ["kind", "runId", "jobId"], "additionalProperties": false }, { "type": "object", "properties": { "kind": { "const": "floor" }, "runId": { "type": "string", "minLength": 1 }, "jobId": { "type": "null" } }, "required": ["kind", "runId", "jobId"], "additionalProperties": false }, { "type": "object", "properties": { "kind": { "const": "job" }, "runId": { "type": ["string", "null"], "minLength": 1 }, "jobId": { "type": "string", "minLength": 1 } }, "required": ["kind", "runId", "jobId"], "additionalProperties": false }, { "type": "object", "properties": { "kind": { "const": "manual" }, "runId": { "type": "null" }, "jobId": { "type": "null" } }, "required": ["kind", "runId", "jobId"], "additionalProperties": false }] };
var func24 = Object.prototype.hasOwnProperty;
function validate12(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  const _errs1 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs2 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.floorId !== void 0) {
      const _errs3 = errors;
      if (data.floorId !== null) {
        const err0 = { instancePath: instancePath + "/floorId", schemaPath: "#/oneOf/0/properties/floorId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      var valid1 = _errs3 === errors;
    } else {
      var valid1 = true;
    }
    if (valid1) {
      if (data.attemptId !== void 0) {
        const _errs5 = errors;
        if (data.attemptId !== null) {
          const err1 = { instancePath: instancePath + "/attemptId", schemaPath: "#/oneOf/0/properties/attemptId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        var valid1 = _errs5 === errors;
      } else {
        var valid1 = true;
      }
      if (valid1) {
        if (data.parentSnapshotId !== void 0) {
          const _errs7 = errors;
          if (data.parentSnapshotId !== null) {
            const err2 = { instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/oneOf/0/properties/parentSnapshotId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
          var valid1 = _errs7 === errors;
        } else {
          var valid1 = true;
        }
        if (valid1) {
          if (data.source !== void 0) {
            let data3 = data.source;
            const _errs9 = errors;
            if (errors === _errs9) {
              if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                if (data3.kind !== void 0) {
                  if (!(data3.kind === "initial")) {
                    const err3 = { instancePath: instancePath + "/source/kind", schemaPath: "#/oneOf/0/properties/source/properties/kind/enum", keyword: "enum", params: { allowedValues: schema14.oneOf[0].properties.source.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                    if (vErrors === null) {
                      vErrors = [err3];
                    } else {
                      vErrors.push(err3);
                    }
                    errors++;
                  }
                }
              } else {
                const err4 = { instancePath: instancePath + "/source", schemaPath: "#/oneOf/0/properties/source/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err4];
                } else {
                  vErrors.push(err4);
                }
                errors++;
              }
            }
            var valid1 = _errs9 === errors;
          } else {
            var valid1 = true;
          }
        }
      }
    }
  }
  var _valid0 = _errs2 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
  }
  const _errs12 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.floorId !== void 0) {
      let data5 = data.floorId;
      const _errs13 = errors;
      if (errors === _errs13) {
        if (typeof data5 === "string") {
          if (func2(data5) < 1) {
            const err5 = { instancePath: instancePath + "/floorId", schemaPath: "#/oneOf/1/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        } else {
          const err6 = { instancePath: instancePath + "/floorId", schemaPath: "#/oneOf/1/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
      var valid3 = _errs13 === errors;
    } else {
      var valid3 = true;
    }
    if (valid3) {
      if (data.attemptId !== void 0) {
        let data6 = data.attemptId;
        const _errs15 = errors;
        if (errors === _errs15) {
          if (typeof data6 === "string") {
            if (func2(data6) < 1) {
              const err7 = { instancePath: instancePath + "/attemptId", schemaPath: "#/oneOf/1/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
            }
          } else {
            const err8 = { instancePath: instancePath + "/attemptId", schemaPath: "#/oneOf/1/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
        var valid3 = _errs15 === errors;
      } else {
        var valid3 = true;
      }
      if (valid3) {
        if (data.parentSnapshotId !== void 0) {
          let data7 = data.parentSnapshotId;
          const _errs17 = errors;
          if (errors === _errs17) {
            if (typeof data7 === "string") {
              if (func2(data7) < 1) {
                const err9 = { instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/oneOf/1/properties/parentSnapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                if (vErrors === null) {
                  vErrors = [err9];
                } else {
                  vErrors.push(err9);
                }
                errors++;
              }
            } else {
              const err10 = { instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/oneOf/1/properties/parentSnapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
          }
          var valid3 = _errs17 === errors;
        } else {
          var valid3 = true;
        }
        if (valid3) {
          if (data.source !== void 0) {
            let data8 = data.source;
            const _errs19 = errors;
            if (errors === _errs19) {
              if (data8 && typeof data8 == "object" && !Array.isArray(data8)) {
                if (data8.kind !== void 0) {
                  let data9 = data8.kind;
                  if (!(data9 === "floor" || data9 === "job")) {
                    const err11 = { instancePath: instancePath + "/source/kind", schemaPath: "#/oneOf/1/properties/source/properties/kind/enum", keyword: "enum", params: { allowedValues: schema14.oneOf[1].properties.source.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                    if (vErrors === null) {
                      vErrors = [err11];
                    } else {
                      vErrors.push(err11);
                    }
                    errors++;
                  }
                }
              } else {
                const err12 = { instancePath: instancePath + "/source", schemaPath: "#/oneOf/1/properties/source/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err12];
                } else {
                  vErrors.push(err12);
                }
                errors++;
              }
            }
            var valid3 = _errs19 === errors;
          } else {
            var valid3 = true;
          }
        }
      }
    }
  }
  var _valid0 = _errs12 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
    }
    const _errs22 = errors;
    const _errs23 = errors;
    let valid5 = false;
    let passing1 = null;
    const _errs24 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.floorId !== void 0) {
        const _errs25 = errors;
        if (data.floorId !== null) {
          const err13 = { instancePath: instancePath + "/floorId", schemaPath: "#/oneOf/2/oneOf/0/properties/floorId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        var valid6 = _errs25 === errors;
      } else {
        var valid6 = true;
      }
      if (valid6) {
        if (data.attemptId !== void 0) {
          const _errs27 = errors;
          if (data.attemptId !== null) {
            const err14 = { instancePath: instancePath + "/attemptId", schemaPath: "#/oneOf/2/oneOf/0/properties/attemptId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          }
          var valid6 = _errs27 === errors;
        } else {
          var valid6 = true;
        }
        if (valid6) {
          if (data.parentSnapshotId !== void 0) {
            const _errs29 = errors;
            if (data.parentSnapshotId !== null) {
              const err15 = { instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/oneOf/2/oneOf/0/properties/parentSnapshotId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
              if (vErrors === null) {
                vErrors = [err15];
              } else {
                vErrors.push(err15);
              }
              errors++;
            }
            var valid6 = _errs29 === errors;
          } else {
            var valid6 = true;
          }
        }
      }
    }
    var _valid1 = _errs24 === errors;
    if (_valid1) {
      valid5 = true;
      passing1 = 0;
    }
    const _errs31 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.floorId !== void 0) {
        let data13 = data.floorId;
        const _errs32 = errors;
        if (errors === _errs32) {
          if (typeof data13 === "string") {
            if (func2(data13) < 1) {
              const err16 = { instancePath: instancePath + "/floorId", schemaPath: "#/oneOf/2/oneOf/1/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err16];
              } else {
                vErrors.push(err16);
              }
              errors++;
            }
          } else {
            const err17 = { instancePath: instancePath + "/floorId", schemaPath: "#/oneOf/2/oneOf/1/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err17];
            } else {
              vErrors.push(err17);
            }
            errors++;
          }
        }
        var valid7 = _errs32 === errors;
      } else {
        var valid7 = true;
      }
      if (valid7) {
        if (data.attemptId !== void 0) {
          let data14 = data.attemptId;
          const _errs34 = errors;
          if (errors === _errs34) {
            if (typeof data14 === "string") {
              if (func2(data14) < 1) {
                const err18 = { instancePath: instancePath + "/attemptId", schemaPath: "#/oneOf/2/oneOf/1/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                if (vErrors === null) {
                  vErrors = [err18];
                } else {
                  vErrors.push(err18);
                }
                errors++;
              }
            } else {
              const err19 = { instancePath: instancePath + "/attemptId", schemaPath: "#/oneOf/2/oneOf/1/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err19];
              } else {
                vErrors.push(err19);
              }
              errors++;
            }
          }
          var valid7 = _errs34 === errors;
        } else {
          var valid7 = true;
        }
        if (valid7) {
          if (data.parentSnapshotId !== void 0) {
            let data15 = data.parentSnapshotId;
            const _errs36 = errors;
            if (errors === _errs36) {
              if (typeof data15 === "string") {
                if (func2(data15) < 1) {
                  const err20 = { instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/oneOf/2/oneOf/1/properties/parentSnapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err20];
                  } else {
                    vErrors.push(err20);
                  }
                  errors++;
                }
              } else {
                const err21 = { instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/oneOf/2/oneOf/1/properties/parentSnapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err21];
                } else {
                  vErrors.push(err21);
                }
                errors++;
              }
            }
            var valid7 = _errs36 === errors;
          } else {
            var valid7 = true;
          }
        }
      }
    }
    var _valid1 = _errs31 === errors;
    if (_valid1 && valid5) {
      valid5 = false;
      passing1 = [passing1, 1];
    } else {
      if (_valid1) {
        valid5 = true;
        passing1 = 1;
      }
    }
    if (!valid5) {
      const err22 = { instancePath, schemaPath: "#/oneOf/2/oneOf", keyword: "oneOf", params: { passingSchemas: passing1 }, message: "must match exactly one schema in oneOf" };
      if (vErrors === null) {
        vErrors = [err22];
      } else {
        vErrors.push(err22);
      }
      errors++;
    } else {
      errors = _errs23;
      if (vErrors !== null) {
        if (_errs23) {
          vErrors.length = _errs23;
        } else {
          vErrors = null;
        }
      }
    }
    if (errors === _errs22) {
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.source !== void 0) {
          let data16 = data.source;
          const _errs38 = errors;
          if (errors === _errs38) {
            if (data16 && typeof data16 == "object" && !Array.isArray(data16)) {
              if (data16.kind !== void 0) {
                if (!(data16.kind === "manual")) {
                  const err23 = { instancePath: instancePath + "/source/kind", schemaPath: "#/oneOf/2/properties/source/properties/kind/enum", keyword: "enum", params: { allowedValues: schema14.oneOf[2].properties.source.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                  if (vErrors === null) {
                    vErrors = [err23];
                  } else {
                    vErrors.push(err23);
                  }
                  errors++;
                }
              }
            } else {
              const err24 = { instancePath: instancePath + "/source", schemaPath: "#/oneOf/2/properties/source/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err24];
              } else {
                vErrors.push(err24);
              }
              errors++;
            }
          }
        }
      }
    }
    var _valid0 = _errs22 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
      }
    }
  }
  if (!valid0) {
    const err25 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err25];
    } else {
      vErrors.push(err25);
    }
    errors++;
    validate12.errors = vErrors;
    return false;
  } else {
    errors = _errs1;
    if (vErrors !== null) {
      if (_errs1) {
        vErrors.length = _errs1;
      } else {
        vErrors = null;
      }
    }
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.sessionId === void 0 && (missing0 = "sessionId") || data.branchId === void 0 && (missing0 = "branchId") || data.floorId === void 0 && (missing0 = "floorId") || data.attemptId === void 0 && (missing0 = "attemptId") || data.versionId === void 0 && (missing0 = "versionId") || data.snapshotId === void 0 && (missing0 = "snapshotId") || data.parentSnapshotId === void 0 && (missing0 = "parentSnapshotId") || data.variables === void 0 && (missing0 = "variables") || data.source === void 0 && (missing0 = "source")) {
        validate12.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs41 = errors;
        for (const key0 in data) {
          if (!func24.call(schema14.properties, key0)) {
            validate12.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs41 === errors) {
          if (data.sessionId !== void 0) {
            let data18 = data.sessionId;
            const _errs42 = errors;
            if (errors === _errs42) {
              if (typeof data18 === "string") {
                if (func2(data18) < 1) {
                  validate12.errors = [{ instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate12.errors = [{ instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid10 = _errs42 === errors;
          } else {
            var valid10 = true;
          }
          if (valid10) {
            if (data.branchId !== void 0) {
              let data19 = data.branchId;
              const _errs44 = errors;
              if (errors === _errs44) {
                if (typeof data19 === "string") {
                  if (func2(data19) < 1) {
                    validate12.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                } else {
                  validate12.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
              }
              var valid10 = _errs44 === errors;
            } else {
              var valid10 = true;
            }
            if (valid10) {
              if (data.floorId !== void 0) {
                let data20 = data.floorId;
                const _errs46 = errors;
                if (typeof data20 !== "string" && data20 !== null) {
                  validate12.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/type", keyword: "type", params: { type: schema14.properties.floorId.type }, message: "must be string,null" }];
                  return false;
                }
                if (errors === _errs46) {
                  if (typeof data20 === "string") {
                    if (func2(data20) < 1) {
                      validate12.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                      return false;
                    }
                  }
                }
                var valid10 = _errs46 === errors;
              } else {
                var valid10 = true;
              }
              if (valid10) {
                if (data.attemptId !== void 0) {
                  let data21 = data.attemptId;
                  const _errs48 = errors;
                  if (typeof data21 !== "string" && data21 !== null) {
                    validate12.errors = [{ instancePath: instancePath + "/attemptId", schemaPath: "#/properties/attemptId/type", keyword: "type", params: { type: schema14.properties.attemptId.type }, message: "must be string,null" }];
                    return false;
                  }
                  if (errors === _errs48) {
                    if (typeof data21 === "string") {
                      if (func2(data21) < 1) {
                        validate12.errors = [{ instancePath: instancePath + "/attemptId", schemaPath: "#/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                        return false;
                      }
                    }
                  }
                  var valid10 = _errs48 === errors;
                } else {
                  var valid10 = true;
                }
                if (valid10) {
                  if (data.versionId !== void 0) {
                    let data22 = data.versionId;
                    const _errs50 = errors;
                    if (errors === _errs50) {
                      if (typeof data22 === "string") {
                        if (func2(data22) < 1) {
                          validate12.errors = [{ instancePath: instancePath + "/versionId", schemaPath: "#/properties/versionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                          return false;
                        }
                      } else {
                        validate12.errors = [{ instancePath: instancePath + "/versionId", schemaPath: "#/properties/versionId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                        return false;
                      }
                    }
                    var valid10 = _errs50 === errors;
                  } else {
                    var valid10 = true;
                  }
                  if (valid10) {
                    if (data.snapshotId !== void 0) {
                      let data23 = data.snapshotId;
                      const _errs52 = errors;
                      if (errors === _errs52) {
                        if (typeof data23 === "string") {
                          if (func2(data23) < 1) {
                            validate12.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                            return false;
                          }
                        } else {
                          validate12.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                          return false;
                        }
                      }
                      var valid10 = _errs52 === errors;
                    } else {
                      var valid10 = true;
                    }
                    if (valid10) {
                      if (data.parentSnapshotId !== void 0) {
                        let data24 = data.parentSnapshotId;
                        const _errs54 = errors;
                        if (typeof data24 !== "string" && data24 !== null) {
                          validate12.errors = [{ instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/properties/parentSnapshotId/type", keyword: "type", params: { type: schema14.properties.parentSnapshotId.type }, message: "must be string,null" }];
                          return false;
                        }
                        if (errors === _errs54) {
                          if (typeof data24 === "string") {
                            if (func2(data24) < 1) {
                              validate12.errors = [{ instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/properties/parentSnapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                              return false;
                            }
                          }
                        }
                        var valid10 = _errs54 === errors;
                      } else {
                        var valid10 = true;
                      }
                      if (valid10) {
                        if (data.variables !== void 0) {
                          let data25 = data.variables;
                          const _errs56 = errors;
                          if (errors === _errs56) {
                            if (data25 && typeof data25 == "object" && !Array.isArray(data25)) {
                            } else {
                              validate12.errors = [{ instancePath: instancePath + "/variables", schemaPath: "#/properties/variables/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                              return false;
                            }
                          }
                          var valid10 = _errs56 === errors;
                        } else {
                          var valid10 = true;
                        }
                        if (valid10) {
                          if (data.source !== void 0) {
                            let data26 = data.source;
                            const _errs59 = errors;
                            const _errs61 = errors;
                            let valid12 = false;
                            let passing2 = null;
                            const _errs62 = errors;
                            if (errors === _errs62) {
                              if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
                                let missing1;
                                if (data26.kind === void 0 && (missing1 = "kind") || data26.runId === void 0 && (missing1 = "runId") || data26.jobId === void 0 && (missing1 = "jobId")) {
                                  const err26 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/0/required", keyword: "required", params: { missingProperty: missing1 }, message: "must have required property '" + missing1 + "'" };
                                  if (vErrors === null) {
                                    vErrors = [err26];
                                  } else {
                                    vErrors.push(err26);
                                  }
                                  errors++;
                                } else {
                                  const _errs64 = errors;
                                  for (const key1 in data26) {
                                    if (!(key1 === "kind" || key1 === "runId" || key1 === "jobId")) {
                                      const err27 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                                      if (vErrors === null) {
                                        vErrors = [err27];
                                      } else {
                                        vErrors.push(err27);
                                      }
                                      errors++;
                                      break;
                                    }
                                  }
                                  if (_errs64 === errors) {
                                    if (data26.kind !== void 0) {
                                      const _errs65 = errors;
                                      if ("initial" !== data26.kind) {
                                        const err28 = { instancePath: instancePath + "/source/kind", schemaPath: "#/definitions/snapshotSource/oneOf/0/properties/kind/const", keyword: "const", params: { allowedValue: "initial" }, message: "must be equal to constant" };
                                        if (vErrors === null) {
                                          vErrors = [err28];
                                        } else {
                                          vErrors.push(err28);
                                        }
                                        errors++;
                                      }
                                      var valid13 = _errs65 === errors;
                                    } else {
                                      var valid13 = true;
                                    }
                                    if (valid13) {
                                      if (data26.runId !== void 0) {
                                        const _errs66 = errors;
                                        if (data26.runId !== null) {
                                          const err29 = { instancePath: instancePath + "/source/runId", schemaPath: "#/definitions/snapshotSource/oneOf/0/properties/runId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                          if (vErrors === null) {
                                            vErrors = [err29];
                                          } else {
                                            vErrors.push(err29);
                                          }
                                          errors++;
                                        }
                                        var valid13 = _errs66 === errors;
                                      } else {
                                        var valid13 = true;
                                      }
                                      if (valid13) {
                                        if (data26.jobId !== void 0) {
                                          const _errs68 = errors;
                                          if (data26.jobId !== null) {
                                            const err30 = { instancePath: instancePath + "/source/jobId", schemaPath: "#/definitions/snapshotSource/oneOf/0/properties/jobId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                            if (vErrors === null) {
                                              vErrors = [err30];
                                            } else {
                                              vErrors.push(err30);
                                            }
                                            errors++;
                                          }
                                          var valid13 = _errs68 === errors;
                                        } else {
                                          var valid13 = true;
                                        }
                                      }
                                    }
                                  }
                                }
                              } else {
                                const err31 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                if (vErrors === null) {
                                  vErrors = [err31];
                                } else {
                                  vErrors.push(err31);
                                }
                                errors++;
                              }
                            }
                            var _valid2 = _errs62 === errors;
                            if (_valid2) {
                              valid12 = true;
                              passing2 = 0;
                            }
                            const _errs70 = errors;
                            if (errors === _errs70) {
                              if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
                                let missing2;
                                if (data26.kind === void 0 && (missing2 = "kind") || data26.runId === void 0 && (missing2 = "runId") || data26.jobId === void 0 && (missing2 = "jobId")) {
                                  const err32 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/1/required", keyword: "required", params: { missingProperty: missing2 }, message: "must have required property '" + missing2 + "'" };
                                  if (vErrors === null) {
                                    vErrors = [err32];
                                  } else {
                                    vErrors.push(err32);
                                  }
                                  errors++;
                                } else {
                                  const _errs72 = errors;
                                  for (const key2 in data26) {
                                    if (!(key2 === "kind" || key2 === "runId" || key2 === "jobId")) {
                                      const err33 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                                      if (vErrors === null) {
                                        vErrors = [err33];
                                      } else {
                                        vErrors.push(err33);
                                      }
                                      errors++;
                                      break;
                                    }
                                  }
                                  if (_errs72 === errors) {
                                    if (data26.kind !== void 0) {
                                      const _errs73 = errors;
                                      if ("floor" !== data26.kind) {
                                        const err34 = { instancePath: instancePath + "/source/kind", schemaPath: "#/definitions/snapshotSource/oneOf/1/properties/kind/const", keyword: "const", params: { allowedValue: "floor" }, message: "must be equal to constant" };
                                        if (vErrors === null) {
                                          vErrors = [err34];
                                        } else {
                                          vErrors.push(err34);
                                        }
                                        errors++;
                                      }
                                      var valid14 = _errs73 === errors;
                                    } else {
                                      var valid14 = true;
                                    }
                                    if (valid14) {
                                      if (data26.runId !== void 0) {
                                        let data31 = data26.runId;
                                        const _errs74 = errors;
                                        if (errors === _errs74) {
                                          if (typeof data31 === "string") {
                                            if (func2(data31) < 1) {
                                              const err35 = { instancePath: instancePath + "/source/runId", schemaPath: "#/definitions/snapshotSource/oneOf/1/properties/runId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                              if (vErrors === null) {
                                                vErrors = [err35];
                                              } else {
                                                vErrors.push(err35);
                                              }
                                              errors++;
                                            }
                                          } else {
                                            const err36 = { instancePath: instancePath + "/source/runId", schemaPath: "#/definitions/snapshotSource/oneOf/1/properties/runId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                            if (vErrors === null) {
                                              vErrors = [err36];
                                            } else {
                                              vErrors.push(err36);
                                            }
                                            errors++;
                                          }
                                        }
                                        var valid14 = _errs74 === errors;
                                      } else {
                                        var valid14 = true;
                                      }
                                      if (valid14) {
                                        if (data26.jobId !== void 0) {
                                          const _errs76 = errors;
                                          if (data26.jobId !== null) {
                                            const err37 = { instancePath: instancePath + "/source/jobId", schemaPath: "#/definitions/snapshotSource/oneOf/1/properties/jobId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                            if (vErrors === null) {
                                              vErrors = [err37];
                                            } else {
                                              vErrors.push(err37);
                                            }
                                            errors++;
                                          }
                                          var valid14 = _errs76 === errors;
                                        } else {
                                          var valid14 = true;
                                        }
                                      }
                                    }
                                  }
                                }
                              } else {
                                const err38 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                if (vErrors === null) {
                                  vErrors = [err38];
                                } else {
                                  vErrors.push(err38);
                                }
                                errors++;
                              }
                            }
                            var _valid2 = _errs70 === errors;
                            if (_valid2 && valid12) {
                              valid12 = false;
                              passing2 = [passing2, 1];
                            } else {
                              if (_valid2) {
                                valid12 = true;
                                passing2 = 1;
                              }
                              const _errs78 = errors;
                              if (errors === _errs78) {
                                if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
                                  let missing3;
                                  if (data26.kind === void 0 && (missing3 = "kind") || data26.runId === void 0 && (missing3 = "runId") || data26.jobId === void 0 && (missing3 = "jobId")) {
                                    const err39 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/2/required", keyword: "required", params: { missingProperty: missing3 }, message: "must have required property '" + missing3 + "'" };
                                    if (vErrors === null) {
                                      vErrors = [err39];
                                    } else {
                                      vErrors.push(err39);
                                    }
                                    errors++;
                                  } else {
                                    const _errs80 = errors;
                                    for (const key3 in data26) {
                                      if (!(key3 === "kind" || key3 === "runId" || key3 === "jobId")) {
                                        const err40 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/2/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
                                        if (vErrors === null) {
                                          vErrors = [err40];
                                        } else {
                                          vErrors.push(err40);
                                        }
                                        errors++;
                                        break;
                                      }
                                    }
                                    if (_errs80 === errors) {
                                      if (data26.kind !== void 0) {
                                        const _errs81 = errors;
                                        if ("job" !== data26.kind) {
                                          const err41 = { instancePath: instancePath + "/source/kind", schemaPath: "#/definitions/snapshotSource/oneOf/2/properties/kind/const", keyword: "const", params: { allowedValue: "job" }, message: "must be equal to constant" };
                                          if (vErrors === null) {
                                            vErrors = [err41];
                                          } else {
                                            vErrors.push(err41);
                                          }
                                          errors++;
                                        }
                                        var valid15 = _errs81 === errors;
                                      } else {
                                        var valid15 = true;
                                      }
                                      if (valid15) {
                                        if (data26.runId !== void 0) {
                                          let data34 = data26.runId;
                                          const _errs82 = errors;
                                          if (typeof data34 !== "string" && data34 !== null) {
                                            const err42 = { instancePath: instancePath + "/source/runId", schemaPath: "#/definitions/snapshotSource/oneOf/2/properties/runId/type", keyword: "type", params: { type: schema15.oneOf[2].properties.runId.type }, message: "must be string,null" };
                                            if (vErrors === null) {
                                              vErrors = [err42];
                                            } else {
                                              vErrors.push(err42);
                                            }
                                            errors++;
                                          }
                                          if (errors === _errs82) {
                                            if (typeof data34 === "string") {
                                              if (func2(data34) < 1) {
                                                const err43 = { instancePath: instancePath + "/source/runId", schemaPath: "#/definitions/snapshotSource/oneOf/2/properties/runId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                                if (vErrors === null) {
                                                  vErrors = [err43];
                                                } else {
                                                  vErrors.push(err43);
                                                }
                                                errors++;
                                              }
                                            }
                                          }
                                          var valid15 = _errs82 === errors;
                                        } else {
                                          var valid15 = true;
                                        }
                                        if (valid15) {
                                          if (data26.jobId !== void 0) {
                                            let data35 = data26.jobId;
                                            const _errs84 = errors;
                                            if (errors === _errs84) {
                                              if (typeof data35 === "string") {
                                                if (func2(data35) < 1) {
                                                  const err44 = { instancePath: instancePath + "/source/jobId", schemaPath: "#/definitions/snapshotSource/oneOf/2/properties/jobId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                                  if (vErrors === null) {
                                                    vErrors = [err44];
                                                  } else {
                                                    vErrors.push(err44);
                                                  }
                                                  errors++;
                                                }
                                              } else {
                                                const err45 = { instancePath: instancePath + "/source/jobId", schemaPath: "#/definitions/snapshotSource/oneOf/2/properties/jobId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                                if (vErrors === null) {
                                                  vErrors = [err45];
                                                } else {
                                                  vErrors.push(err45);
                                                }
                                                errors++;
                                              }
                                            }
                                            var valid15 = _errs84 === errors;
                                          } else {
                                            var valid15 = true;
                                          }
                                        }
                                      }
                                    }
                                  }
                                } else {
                                  const err46 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/2/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                  if (vErrors === null) {
                                    vErrors = [err46];
                                  } else {
                                    vErrors.push(err46);
                                  }
                                  errors++;
                                }
                              }
                              var _valid2 = _errs78 === errors;
                              if (_valid2 && valid12) {
                                valid12 = false;
                                passing2 = [passing2, 2];
                              } else {
                                if (_valid2) {
                                  valid12 = true;
                                  passing2 = 2;
                                }
                                const _errs86 = errors;
                                if (errors === _errs86) {
                                  if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
                                    let missing4;
                                    if (data26.kind === void 0 && (missing4 = "kind") || data26.runId === void 0 && (missing4 = "runId") || data26.jobId === void 0 && (missing4 = "jobId")) {
                                      const err47 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/3/required", keyword: "required", params: { missingProperty: missing4 }, message: "must have required property '" + missing4 + "'" };
                                      if (vErrors === null) {
                                        vErrors = [err47];
                                      } else {
                                        vErrors.push(err47);
                                      }
                                      errors++;
                                    } else {
                                      const _errs88 = errors;
                                      for (const key4 in data26) {
                                        if (!(key4 === "kind" || key4 === "runId" || key4 === "jobId")) {
                                          const err48 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/3/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
                                          if (vErrors === null) {
                                            vErrors = [err48];
                                          } else {
                                            vErrors.push(err48);
                                          }
                                          errors++;
                                          break;
                                        }
                                      }
                                      if (_errs88 === errors) {
                                        if (data26.kind !== void 0) {
                                          const _errs89 = errors;
                                          if ("manual" !== data26.kind) {
                                            const err49 = { instancePath: instancePath + "/source/kind", schemaPath: "#/definitions/snapshotSource/oneOf/3/properties/kind/const", keyword: "const", params: { allowedValue: "manual" }, message: "must be equal to constant" };
                                            if (vErrors === null) {
                                              vErrors = [err49];
                                            } else {
                                              vErrors.push(err49);
                                            }
                                            errors++;
                                          }
                                          var valid16 = _errs89 === errors;
                                        } else {
                                          var valid16 = true;
                                        }
                                        if (valid16) {
                                          if (data26.runId !== void 0) {
                                            const _errs90 = errors;
                                            if (data26.runId !== null) {
                                              const err50 = { instancePath: instancePath + "/source/runId", schemaPath: "#/definitions/snapshotSource/oneOf/3/properties/runId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                              if (vErrors === null) {
                                                vErrors = [err50];
                                              } else {
                                                vErrors.push(err50);
                                              }
                                              errors++;
                                            }
                                            var valid16 = _errs90 === errors;
                                          } else {
                                            var valid16 = true;
                                          }
                                          if (valid16) {
                                            if (data26.jobId !== void 0) {
                                              const _errs92 = errors;
                                              if (data26.jobId !== null) {
                                                const err51 = { instancePath: instancePath + "/source/jobId", schemaPath: "#/definitions/snapshotSource/oneOf/3/properties/jobId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                                if (vErrors === null) {
                                                  vErrors = [err51];
                                                } else {
                                                  vErrors.push(err51);
                                                }
                                                errors++;
                                              }
                                              var valid16 = _errs92 === errors;
                                            } else {
                                              var valid16 = true;
                                            }
                                          }
                                        }
                                      }
                                    }
                                  } else {
                                    const err52 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/3/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                    if (vErrors === null) {
                                      vErrors = [err52];
                                    } else {
                                      vErrors.push(err52);
                                    }
                                    errors++;
                                  }
                                }
                                var _valid2 = _errs86 === errors;
                                if (_valid2 && valid12) {
                                  valid12 = false;
                                  passing2 = [passing2, 3];
                                } else {
                                  if (_valid2) {
                                    valid12 = true;
                                    passing2 = 3;
                                  }
                                }
                              }
                            }
                            if (!valid12) {
                              const err53 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf", keyword: "oneOf", params: { passingSchemas: passing2 }, message: "must match exactly one schema in oneOf" };
                              if (vErrors === null) {
                                vErrors = [err53];
                              } else {
                                vErrors.push(err53);
                              }
                              errors++;
                              validate12.errors = vErrors;
                              return false;
                            } else {
                              errors = _errs61;
                              if (vErrors !== null) {
                                if (_errs61) {
                                  vErrors.length = _errs61;
                                } else {
                                  vErrors = null;
                                }
                              }
                            }
                            var valid10 = _errs59 === errors;
                          } else {
                            var valid10 = true;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate12.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate12.errors = vErrors;
  return errors === 0;
}
var error = validate13;
function validate13(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.code === void 0 && (missing0 = "code") || data.message === void 0 && (missing0 = "message")) {
        validate13.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "code" || key0 === "message")) {
            validate13.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.code !== void 0) {
            let data0 = data.code;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate13.errors = [{ instancePath: instancePath + "/code", schemaPath: "#/properties/code/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate13.errors = [{ instancePath: instancePath + "/code", schemaPath: "#/properties/code/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.message !== void 0) {
              let data1 = data.message;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (typeof data1 === "string") {
                  if (func2(data1) < 1) {
                    validate13.errors = [{ instancePath: instancePath + "/message", schemaPath: "#/properties/message/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                } else {
                  validate13.errors = [{ instancePath: instancePath + "/message", schemaPath: "#/properties/message/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate13.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate13.errors = vErrors;
  return errors === 0;
}
var floorVariables = validate14;
function validate14(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.before === void 0 && (missing0 = "before") || data.after === void 0 && (missing0 = "after")) {
        validate14.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "before" || key0 === "after")) {
            validate14.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.before !== void 0) {
            const _errs2 = errors;
            if (!validate12(data.before, { instancePath: instancePath + "/before", parentData: data, parentDataProperty: "before", rootData })) {
              vErrors = vErrors === null ? validate12.errors : vErrors.concat(validate12.errors);
              errors = vErrors.length;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.after !== void 0) {
              let data1 = data.after;
              const _errs3 = errors;
              const _errs4 = errors;
              if (!validate12(data1, { instancePath: instancePath + "/after", parentData: data, parentDataProperty: "after", rootData })) {
                vErrors = vErrors === null ? validate12.errors : vErrors.concat(validate12.errors);
                errors = vErrors.length;
              }
              var valid1 = _errs4 === errors;
              if (valid1) {
                const _errs5 = errors;
                if (errors === _errs5) {
                  if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                    if (data1.floorId !== void 0) {
                      let data2 = data1.floorId;
                      const _errs7 = errors;
                      if (errors === _errs7) {
                        if (typeof data2 === "string") {
                          if (func2(data2) < 1) {
                            validate14.errors = [{ instancePath: instancePath + "/after/floorId", schemaPath: "#/properties/after/allOf/1/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                            return false;
                          }
                        } else {
                          validate14.errors = [{ instancePath: instancePath + "/after/floorId", schemaPath: "#/properties/after/allOf/1/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                          return false;
                        }
                      }
                      var valid2 = _errs7 === errors;
                    } else {
                      var valid2 = true;
                    }
                    if (valid2) {
                      if (data1.attemptId !== void 0) {
                        let data3 = data1.attemptId;
                        const _errs9 = errors;
                        if (errors === _errs9) {
                          if (typeof data3 === "string") {
                            if (func2(data3) < 1) {
                              validate14.errors = [{ instancePath: instancePath + "/after/attemptId", schemaPath: "#/properties/after/allOf/1/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                              return false;
                            }
                          } else {
                            validate14.errors = [{ instancePath: instancePath + "/after/attemptId", schemaPath: "#/properties/after/allOf/1/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                            return false;
                          }
                        }
                        var valid2 = _errs9 === errors;
                      } else {
                        var valid2 = true;
                      }
                      if (valid2) {
                        if (data1.source !== void 0) {
                          let data4 = data1.source;
                          const _errs11 = errors;
                          if (errors === _errs11) {
                            if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
                              if (data4.kind !== void 0) {
                                if ("floor" !== data4.kind) {
                                  validate14.errors = [{ instancePath: instancePath + "/after/source/kind", schemaPath: "#/properties/after/allOf/1/properties/source/properties/kind/const", keyword: "const", params: { allowedValue: "floor" }, message: "must be equal to constant" }];
                                  return false;
                                }
                              }
                            } else {
                              validate14.errors = [{ instancePath: instancePath + "/after/source", schemaPath: "#/properties/after/allOf/1/properties/source/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                              return false;
                            }
                          }
                          var valid2 = _errs11 === errors;
                        } else {
                          var valid2 = true;
                        }
                      }
                    }
                  } else {
                    validate14.errors = [{ instancePath: instancePath + "/after", schemaPath: "#/properties/after/allOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                    return false;
                  }
                }
                var valid1 = _errs5 === errors;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate14.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate14.errors = vErrors;
  return errors === 0;
}
var turnCommit = validate17;
var schema18 = { "type": "object", "properties": { "eventId": { "type": "string", "minLength": 1 }, "sessionId": { "type": "string", "minLength": 1 }, "branchId": { "type": "string", "minLength": 1 }, "kind": { "enum": ["generated", "retried", "regenerated"] }, "previousCurrentSnapshotId": { "type": "string", "minLength": 1 }, "before": { "$ref": "#/definitions/record" }, "after": { "allOf": [{ "$ref": "#/definitions/record" }, { "properties": { "floorId": { "type": "string", "minLength": 1 }, "attemptId": { "type": "string", "minLength": 1 }, "source": { "type": "object", "properties": { "kind": { "const": "floor" } } } }, "type": "object" }] } }, "required": ["eventId", "sessionId", "branchId", "kind", "previousCurrentSnapshotId", "before", "after"], "additionalProperties": false };
function validate17(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.eventId === void 0 && (missing0 = "eventId") || data.sessionId === void 0 && (missing0 = "sessionId") || data.branchId === void 0 && (missing0 = "branchId") || data.kind === void 0 && (missing0 = "kind") || data.previousCurrentSnapshotId === void 0 && (missing0 = "previousCurrentSnapshotId") || data.before === void 0 && (missing0 = "before") || data.after === void 0 && (missing0 = "after")) {
        validate17.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "eventId" || key0 === "sessionId" || key0 === "branchId" || key0 === "kind" || key0 === "previousCurrentSnapshotId" || key0 === "before" || key0 === "after")) {
            validate17.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.eventId !== void 0) {
            let data0 = data.eventId;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate17.errors = [{ instancePath: instancePath + "/eventId", schemaPath: "#/properties/eventId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate17.errors = [{ instancePath: instancePath + "/eventId", schemaPath: "#/properties/eventId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.sessionId !== void 0) {
              let data1 = data.sessionId;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (typeof data1 === "string") {
                  if (func2(data1) < 1) {
                    validate17.errors = [{ instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                } else {
                  validate17.errors = [{ instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.branchId !== void 0) {
                let data2 = data.branchId;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (typeof data2 === "string") {
                    if (func2(data2) < 1) {
                      validate17.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                      return false;
                    }
                  } else {
                    validate17.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.kind !== void 0) {
                  let data3 = data.kind;
                  const _errs8 = errors;
                  if (!(data3 === "generated" || data3 === "retried" || data3 === "regenerated")) {
                    validate17.errors = [{ instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema18.properties.kind.enum }, message: "must be equal to one of the allowed values" }];
                    return false;
                  }
                  var valid0 = _errs8 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.previousCurrentSnapshotId !== void 0) {
                    let data4 = data.previousCurrentSnapshotId;
                    const _errs9 = errors;
                    if (errors === _errs9) {
                      if (typeof data4 === "string") {
                        if (func2(data4) < 1) {
                          validate17.errors = [{ instancePath: instancePath + "/previousCurrentSnapshotId", schemaPath: "#/properties/previousCurrentSnapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                          return false;
                        }
                      } else {
                        validate17.errors = [{ instancePath: instancePath + "/previousCurrentSnapshotId", schemaPath: "#/properties/previousCurrentSnapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                        return false;
                      }
                    }
                    var valid0 = _errs9 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.before !== void 0) {
                      const _errs11 = errors;
                      if (!validate12(data.before, { instancePath: instancePath + "/before", parentData: data, parentDataProperty: "before", rootData })) {
                        vErrors = vErrors === null ? validate12.errors : vErrors.concat(validate12.errors);
                        errors = vErrors.length;
                      }
                      var valid0 = _errs11 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.after !== void 0) {
                        let data6 = data.after;
                        const _errs12 = errors;
                        const _errs13 = errors;
                        if (!validate12(data6, { instancePath: instancePath + "/after", parentData: data, parentDataProperty: "after", rootData })) {
                          vErrors = vErrors === null ? validate12.errors : vErrors.concat(validate12.errors);
                          errors = vErrors.length;
                        }
                        var valid1 = _errs13 === errors;
                        if (valid1) {
                          const _errs14 = errors;
                          if (errors === _errs14) {
                            if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
                              if (data6.floorId !== void 0) {
                                let data7 = data6.floorId;
                                const _errs16 = errors;
                                if (errors === _errs16) {
                                  if (typeof data7 === "string") {
                                    if (func2(data7) < 1) {
                                      validate17.errors = [{ instancePath: instancePath + "/after/floorId", schemaPath: "#/properties/after/allOf/1/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                      return false;
                                    }
                                  } else {
                                    validate17.errors = [{ instancePath: instancePath + "/after/floorId", schemaPath: "#/properties/after/allOf/1/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                    return false;
                                  }
                                }
                                var valid2 = _errs16 === errors;
                              } else {
                                var valid2 = true;
                              }
                              if (valid2) {
                                if (data6.attemptId !== void 0) {
                                  let data8 = data6.attemptId;
                                  const _errs18 = errors;
                                  if (errors === _errs18) {
                                    if (typeof data8 === "string") {
                                      if (func2(data8) < 1) {
                                        validate17.errors = [{ instancePath: instancePath + "/after/attemptId", schemaPath: "#/properties/after/allOf/1/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                        return false;
                                      }
                                    } else {
                                      validate17.errors = [{ instancePath: instancePath + "/after/attemptId", schemaPath: "#/properties/after/allOf/1/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                      return false;
                                    }
                                  }
                                  var valid2 = _errs18 === errors;
                                } else {
                                  var valid2 = true;
                                }
                                if (valid2) {
                                  if (data6.source !== void 0) {
                                    let data9 = data6.source;
                                    const _errs20 = errors;
                                    if (errors === _errs20) {
                                      if (data9 && typeof data9 == "object" && !Array.isArray(data9)) {
                                        if (data9.kind !== void 0) {
                                          if ("floor" !== data9.kind) {
                                            validate17.errors = [{ instancePath: instancePath + "/after/source/kind", schemaPath: "#/properties/after/allOf/1/properties/source/properties/kind/const", keyword: "const", params: { allowedValue: "floor" }, message: "must be equal to constant" }];
                                            return false;
                                          }
                                        }
                                      } else {
                                        validate17.errors = [{ instancePath: instancePath + "/after/source", schemaPath: "#/properties/after/allOf/1/properties/source/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                                        return false;
                                      }
                                    }
                                    var valid2 = _errs20 === errors;
                                  } else {
                                    var valid2 = true;
                                  }
                                }
                              }
                            } else {
                              validate17.errors = [{ instancePath: instancePath + "/after", schemaPath: "#/properties/after/allOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                              return false;
                            }
                          }
                          var valid1 = _errs14 === errors;
                        }
                        var valid0 = _errs12 === errors;
                      } else {
                        var valid0 = true;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate17.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate17.errors = vErrors;
  return errors === 0;
}
var floorPage = validate20;
var schema19 = { "type": "object", "properties": { "items": { "type": "array", "items": { "type": "object", "properties": { "floorId": { "type": "string", "minLength": 1 }, "attemptId": { "type": "string", "minLength": 1 }, "snapshotId": { "type": "string", "minLength": 1 } }, "required": ["floorId", "attemptId", "snapshotId"], "additionalProperties": false } }, "nextCursor": { "type": ["string", "null"], "minLength": 1 } }, "required": ["items", "nextCursor"], "additionalProperties": false };
function validate20(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.items === void 0 && (missing0 = "items") || data.nextCursor === void 0 && (missing0 = "nextCursor")) {
        validate20.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "items" || key0 === "nextCursor")) {
            validate20.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.items !== void 0) {
            let data0 = data.items;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (Array.isArray(data0)) {
                var valid1 = true;
                const len0 = data0.length;
                for (let i0 = 0; i0 < len0; i0++) {
                  let data1 = data0[i0];
                  const _errs4 = errors;
                  if (errors === _errs4) {
                    if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                      let missing1;
                      if (data1.floorId === void 0 && (missing1 = "floorId") || data1.attemptId === void 0 && (missing1 = "attemptId") || data1.snapshotId === void 0 && (missing1 = "snapshotId")) {
                        validate20.errors = [{ instancePath: instancePath + "/items/" + i0, schemaPath: "#/properties/items/items/required", keyword: "required", params: { missingProperty: missing1 }, message: "must have required property '" + missing1 + "'" }];
                        return false;
                      } else {
                        const _errs6 = errors;
                        for (const key1 in data1) {
                          if (!(key1 === "floorId" || key1 === "attemptId" || key1 === "snapshotId")) {
                            validate20.errors = [{ instancePath: instancePath + "/items/" + i0, schemaPath: "#/properties/items/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                            return false;
                            break;
                          }
                        }
                        if (_errs6 === errors) {
                          if (data1.floorId !== void 0) {
                            let data2 = data1.floorId;
                            const _errs7 = errors;
                            if (errors === _errs7) {
                              if (typeof data2 === "string") {
                                if (func2(data2) < 1) {
                                  validate20.errors = [{ instancePath: instancePath + "/items/" + i0 + "/floorId", schemaPath: "#/properties/items/items/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                  return false;
                                }
                              } else {
                                validate20.errors = [{ instancePath: instancePath + "/items/" + i0 + "/floorId", schemaPath: "#/properties/items/items/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                return false;
                              }
                            }
                            var valid2 = _errs7 === errors;
                          } else {
                            var valid2 = true;
                          }
                          if (valid2) {
                            if (data1.attemptId !== void 0) {
                              let data3 = data1.attemptId;
                              const _errs9 = errors;
                              if (errors === _errs9) {
                                if (typeof data3 === "string") {
                                  if (func2(data3) < 1) {
                                    validate20.errors = [{ instancePath: instancePath + "/items/" + i0 + "/attemptId", schemaPath: "#/properties/items/items/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                    return false;
                                  }
                                } else {
                                  validate20.errors = [{ instancePath: instancePath + "/items/" + i0 + "/attemptId", schemaPath: "#/properties/items/items/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                  return false;
                                }
                              }
                              var valid2 = _errs9 === errors;
                            } else {
                              var valid2 = true;
                            }
                            if (valid2) {
                              if (data1.snapshotId !== void 0) {
                                let data4 = data1.snapshotId;
                                const _errs11 = errors;
                                if (errors === _errs11) {
                                  if (typeof data4 === "string") {
                                    if (func2(data4) < 1) {
                                      validate20.errors = [{ instancePath: instancePath + "/items/" + i0 + "/snapshotId", schemaPath: "#/properties/items/items/properties/snapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                      return false;
                                    }
                                  } else {
                                    validate20.errors = [{ instancePath: instancePath + "/items/" + i0 + "/snapshotId", schemaPath: "#/properties/items/items/properties/snapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                    return false;
                                  }
                                }
                                var valid2 = _errs11 === errors;
                              } else {
                                var valid2 = true;
                              }
                            }
                          }
                        }
                      }
                    } else {
                      validate20.errors = [{ instancePath: instancePath + "/items/" + i0, schemaPath: "#/properties/items/items/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                      return false;
                    }
                  }
                  var valid1 = _errs4 === errors;
                  if (!valid1) {
                    break;
                  }
                }
              } else {
                validate20.errors = [{ instancePath: instancePath + "/items", schemaPath: "#/properties/items/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.nextCursor !== void 0) {
              let data5 = data.nextCursor;
              const _errs13 = errors;
              if (typeof data5 !== "string" && data5 !== null) {
                validate20.errors = [{ instancePath: instancePath + "/nextCursor", schemaPath: "#/properties/nextCursor/type", keyword: "type", params: { type: schema19.properties.nextCursor.type }, message: "must be string,null" }];
                return false;
              }
              if (errors === _errs13) {
                if (typeof data5 === "string") {
                  if (func2(data5) < 1) {
                    validate20.errors = [{ instancePath: instancePath + "/nextCursor", schemaPath: "#/properties/nextCursor/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                }
              }
              var valid0 = _errs13 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate20.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate20.errors = vErrors;
  return errors === 0;
}
var chatSetDraftParams = validate21;
function validate21(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.text === void 0 && (missing0 = "text")) {
        validate21.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "text")) {
            validate21.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.text !== void 0) {
            if (typeof data.text !== "string") {
              validate21.errors = [{ instancePath: instancePath + "/text", schemaPath: "#/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
              return false;
            }
          }
        }
      }
    } else {
      validate21.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate21.errors = vErrors;
  return errors === 0;
}
var chatSetDraftResult = validate22;
function validate22(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data !== null) {
    validate22.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "null" }, message: "must be null" }];
    return false;
  }
  validate22.errors = vErrors;
  return errors === 0;
}
var chatSendParams = validate23;
function validate23(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.text === void 0 && (missing0 = "text")) {
        validate23.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "text")) {
            validate23.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.text !== void 0) {
            let data0 = data.text;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate23.errors = [{ instancePath: instancePath + "/text", schemaPath: "#/properties/text/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate23.errors = [{ instancePath: instancePath + "/text", schemaPath: "#/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
          }
        }
      }
    } else {
      validate23.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate23.errors = vErrors;
  return errors === 0;
}
var chatSendResult = validate24;
function validate24(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.snapshotId === void 0 && (missing0 = "snapshotId")) {
        validate24.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "snapshotId")) {
            validate24.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.snapshotId !== void 0) {
            let data0 = data.snapshotId;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate24.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate24.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
          }
        }
      }
    } else {
      validate24.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate24.errors = vErrors;
  return errors === 0;
}
var historySelectParams = validate25;
function validate25(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.snapshotId === void 0 && (missing0 = "snapshotId")) {
        validate25.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "snapshotId")) {
            validate25.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.snapshotId !== void 0) {
            let data0 = data.snapshotId;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate25.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate25.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
          }
        }
      }
    } else {
      validate25.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate25.errors = vErrors;
  return errors === 0;
}
var historySelectResult = validate26;
function validate26(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.snapshotId === void 0 && (missing0 = "snapshotId")) {
        validate26.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "snapshotId")) {
            validate26.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.snapshotId !== void 0) {
            let data0 = data.snapshotId;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate26.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate26.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
          }
        }
      }
    } else {
      validate26.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate26.errors = vErrors;
  return errors === 0;
}
var historyLatestParams = validate27;
function validate27(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      for (const key0 in data) {
        validate27.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
        return false;
        break;
      }
    } else {
      validate27.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate27.errors = vErrors;
  return errors === 0;
}
var historyLatestResult = validate28;
function validate28(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.snapshotId === void 0 && (missing0 = "snapshotId")) {
        validate28.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "snapshotId")) {
            validate28.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.snapshotId !== void 0) {
            let data0 = data.snapshotId;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate28.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate28.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
          }
        }
      }
    } else {
      validate28.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate28.errors = vErrors;
  return errors === 0;
}
var variablesGetFloorParams = validate29;
function validate29(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.branchId === void 0 && (missing0 = "branchId") || data.floorId === void 0 && (missing0 = "floorId")) {
        validate29.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "branchId" || key0 === "floorId" || key0 === "attemptId")) {
            validate29.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.branchId !== void 0) {
            let data0 = data.branchId;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate29.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate29.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.floorId !== void 0) {
              let data1 = data.floorId;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (typeof data1 === "string") {
                  if (func2(data1) < 1) {
                    validate29.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                } else {
                  validate29.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.attemptId !== void 0) {
                let data2 = data.attemptId;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (typeof data2 === "string") {
                    if (func2(data2) < 1) {
                      validate29.errors = [{ instancePath: instancePath + "/attemptId", schemaPath: "#/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                      return false;
                    }
                  } else {
                    validate29.errors = [{ instancePath: instancePath + "/attemptId", schemaPath: "#/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate29.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate29.errors = vErrors;
  return errors === 0;
}
var variablesGetFloorResult = validate30;
function validate30(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.before === void 0 && (missing0 = "before") || data.after === void 0 && (missing0 = "after")) {
        validate30.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "before" || key0 === "after")) {
            validate30.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.before !== void 0) {
            const _errs2 = errors;
            if (!validate12(data.before, { instancePath: instancePath + "/before", parentData: data, parentDataProperty: "before", rootData })) {
              vErrors = vErrors === null ? validate12.errors : vErrors.concat(validate12.errors);
              errors = vErrors.length;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.after !== void 0) {
              let data1 = data.after;
              const _errs3 = errors;
              const _errs4 = errors;
              if (!validate12(data1, { instancePath: instancePath + "/after", parentData: data, parentDataProperty: "after", rootData })) {
                vErrors = vErrors === null ? validate12.errors : vErrors.concat(validate12.errors);
                errors = vErrors.length;
              }
              var valid1 = _errs4 === errors;
              if (valid1) {
                const _errs5 = errors;
                if (errors === _errs5) {
                  if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                    if (data1.floorId !== void 0) {
                      let data2 = data1.floorId;
                      const _errs7 = errors;
                      if (errors === _errs7) {
                        if (typeof data2 === "string") {
                          if (func2(data2) < 1) {
                            validate30.errors = [{ instancePath: instancePath + "/after/floorId", schemaPath: "#/properties/after/allOf/1/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                            return false;
                          }
                        } else {
                          validate30.errors = [{ instancePath: instancePath + "/after/floorId", schemaPath: "#/properties/after/allOf/1/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                          return false;
                        }
                      }
                      var valid2 = _errs7 === errors;
                    } else {
                      var valid2 = true;
                    }
                    if (valid2) {
                      if (data1.attemptId !== void 0) {
                        let data3 = data1.attemptId;
                        const _errs9 = errors;
                        if (errors === _errs9) {
                          if (typeof data3 === "string") {
                            if (func2(data3) < 1) {
                              validate30.errors = [{ instancePath: instancePath + "/after/attemptId", schemaPath: "#/properties/after/allOf/1/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                              return false;
                            }
                          } else {
                            validate30.errors = [{ instancePath: instancePath + "/after/attemptId", schemaPath: "#/properties/after/allOf/1/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                            return false;
                          }
                        }
                        var valid2 = _errs9 === errors;
                      } else {
                        var valid2 = true;
                      }
                      if (valid2) {
                        if (data1.source !== void 0) {
                          let data4 = data1.source;
                          const _errs11 = errors;
                          if (errors === _errs11) {
                            if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
                              if (data4.kind !== void 0) {
                                if ("floor" !== data4.kind) {
                                  validate30.errors = [{ instancePath: instancePath + "/after/source/kind", schemaPath: "#/properties/after/allOf/1/properties/source/properties/kind/const", keyword: "const", params: { allowedValue: "floor" }, message: "must be equal to constant" }];
                                  return false;
                                }
                              }
                            } else {
                              validate30.errors = [{ instancePath: instancePath + "/after/source", schemaPath: "#/properties/after/allOf/1/properties/source/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                              return false;
                            }
                          }
                          var valid2 = _errs11 === errors;
                        } else {
                          var valid2 = true;
                        }
                      }
                    }
                  } else {
                    validate30.errors = [{ instancePath: instancePath + "/after", schemaPath: "#/properties/after/allOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                    return false;
                  }
                }
                var valid1 = _errs5 === errors;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate30.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate30.errors = vErrors;
  return errors === 0;
}
var variablesGetSnapshotParams = validate33;
function validate33(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.snapshotId === void 0 && (missing0 = "snapshotId")) {
        validate33.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "snapshotId")) {
            validate33.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.snapshotId !== void 0) {
            let data0 = data.snapshotId;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate33.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate33.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
          }
        }
      }
    } else {
      validate33.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate33.errors = vErrors;
  return errors === 0;
}
var variablesGetSnapshotResult = validate34;
function validate34(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  const _errs1 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs2 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.floorId !== void 0) {
      const _errs3 = errors;
      if (data.floorId !== null) {
        const err0 = { instancePath: instancePath + "/floorId", schemaPath: "#/oneOf/0/properties/floorId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      var valid1 = _errs3 === errors;
    } else {
      var valid1 = true;
    }
    if (valid1) {
      if (data.attemptId !== void 0) {
        const _errs5 = errors;
        if (data.attemptId !== null) {
          const err1 = { instancePath: instancePath + "/attemptId", schemaPath: "#/oneOf/0/properties/attemptId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        var valid1 = _errs5 === errors;
      } else {
        var valid1 = true;
      }
      if (valid1) {
        if (data.parentSnapshotId !== void 0) {
          const _errs7 = errors;
          if (data.parentSnapshotId !== null) {
            const err2 = { instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/oneOf/0/properties/parentSnapshotId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
          var valid1 = _errs7 === errors;
        } else {
          var valid1 = true;
        }
        if (valid1) {
          if (data.source !== void 0) {
            let data3 = data.source;
            const _errs9 = errors;
            if (errors === _errs9) {
              if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                if (data3.kind !== void 0) {
                  if (!(data3.kind === "initial")) {
                    const err3 = { instancePath: instancePath + "/source/kind", schemaPath: "#/oneOf/0/properties/source/properties/kind/enum", keyword: "enum", params: { allowedValues: schema14.oneOf[0].properties.source.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                    if (vErrors === null) {
                      vErrors = [err3];
                    } else {
                      vErrors.push(err3);
                    }
                    errors++;
                  }
                }
              } else {
                const err4 = { instancePath: instancePath + "/source", schemaPath: "#/oneOf/0/properties/source/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err4];
                } else {
                  vErrors.push(err4);
                }
                errors++;
              }
            }
            var valid1 = _errs9 === errors;
          } else {
            var valid1 = true;
          }
        }
      }
    }
  }
  var _valid0 = _errs2 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
  }
  const _errs12 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.floorId !== void 0) {
      let data5 = data.floorId;
      const _errs13 = errors;
      if (errors === _errs13) {
        if (typeof data5 === "string") {
          if (func2(data5) < 1) {
            const err5 = { instancePath: instancePath + "/floorId", schemaPath: "#/oneOf/1/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        } else {
          const err6 = { instancePath: instancePath + "/floorId", schemaPath: "#/oneOf/1/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
      var valid3 = _errs13 === errors;
    } else {
      var valid3 = true;
    }
    if (valid3) {
      if (data.attemptId !== void 0) {
        let data6 = data.attemptId;
        const _errs15 = errors;
        if (errors === _errs15) {
          if (typeof data6 === "string") {
            if (func2(data6) < 1) {
              const err7 = { instancePath: instancePath + "/attemptId", schemaPath: "#/oneOf/1/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
            }
          } else {
            const err8 = { instancePath: instancePath + "/attemptId", schemaPath: "#/oneOf/1/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
        var valid3 = _errs15 === errors;
      } else {
        var valid3 = true;
      }
      if (valid3) {
        if (data.parentSnapshotId !== void 0) {
          let data7 = data.parentSnapshotId;
          const _errs17 = errors;
          if (errors === _errs17) {
            if (typeof data7 === "string") {
              if (func2(data7) < 1) {
                const err9 = { instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/oneOf/1/properties/parentSnapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                if (vErrors === null) {
                  vErrors = [err9];
                } else {
                  vErrors.push(err9);
                }
                errors++;
              }
            } else {
              const err10 = { instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/oneOf/1/properties/parentSnapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
          }
          var valid3 = _errs17 === errors;
        } else {
          var valid3 = true;
        }
        if (valid3) {
          if (data.source !== void 0) {
            let data8 = data.source;
            const _errs19 = errors;
            if (errors === _errs19) {
              if (data8 && typeof data8 == "object" && !Array.isArray(data8)) {
                if (data8.kind !== void 0) {
                  let data9 = data8.kind;
                  if (!(data9 === "floor" || data9 === "job")) {
                    const err11 = { instancePath: instancePath + "/source/kind", schemaPath: "#/oneOf/1/properties/source/properties/kind/enum", keyword: "enum", params: { allowedValues: schema14.oneOf[1].properties.source.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                    if (vErrors === null) {
                      vErrors = [err11];
                    } else {
                      vErrors.push(err11);
                    }
                    errors++;
                  }
                }
              } else {
                const err12 = { instancePath: instancePath + "/source", schemaPath: "#/oneOf/1/properties/source/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err12];
                } else {
                  vErrors.push(err12);
                }
                errors++;
              }
            }
            var valid3 = _errs19 === errors;
          } else {
            var valid3 = true;
          }
        }
      }
    }
  }
  var _valid0 = _errs12 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
    }
    const _errs22 = errors;
    const _errs23 = errors;
    let valid5 = false;
    let passing1 = null;
    const _errs24 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.floorId !== void 0) {
        const _errs25 = errors;
        if (data.floorId !== null) {
          const err13 = { instancePath: instancePath + "/floorId", schemaPath: "#/oneOf/2/oneOf/0/properties/floorId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        var valid6 = _errs25 === errors;
      } else {
        var valid6 = true;
      }
      if (valid6) {
        if (data.attemptId !== void 0) {
          const _errs27 = errors;
          if (data.attemptId !== null) {
            const err14 = { instancePath: instancePath + "/attemptId", schemaPath: "#/oneOf/2/oneOf/0/properties/attemptId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          }
          var valid6 = _errs27 === errors;
        } else {
          var valid6 = true;
        }
        if (valid6) {
          if (data.parentSnapshotId !== void 0) {
            const _errs29 = errors;
            if (data.parentSnapshotId !== null) {
              const err15 = { instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/oneOf/2/oneOf/0/properties/parentSnapshotId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
              if (vErrors === null) {
                vErrors = [err15];
              } else {
                vErrors.push(err15);
              }
              errors++;
            }
            var valid6 = _errs29 === errors;
          } else {
            var valid6 = true;
          }
        }
      }
    }
    var _valid1 = _errs24 === errors;
    if (_valid1) {
      valid5 = true;
      passing1 = 0;
    }
    const _errs31 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.floorId !== void 0) {
        let data13 = data.floorId;
        const _errs32 = errors;
        if (errors === _errs32) {
          if (typeof data13 === "string") {
            if (func2(data13) < 1) {
              const err16 = { instancePath: instancePath + "/floorId", schemaPath: "#/oneOf/2/oneOf/1/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err16];
              } else {
                vErrors.push(err16);
              }
              errors++;
            }
          } else {
            const err17 = { instancePath: instancePath + "/floorId", schemaPath: "#/oneOf/2/oneOf/1/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err17];
            } else {
              vErrors.push(err17);
            }
            errors++;
          }
        }
        var valid7 = _errs32 === errors;
      } else {
        var valid7 = true;
      }
      if (valid7) {
        if (data.attemptId !== void 0) {
          let data14 = data.attemptId;
          const _errs34 = errors;
          if (errors === _errs34) {
            if (typeof data14 === "string") {
              if (func2(data14) < 1) {
                const err18 = { instancePath: instancePath + "/attemptId", schemaPath: "#/oneOf/2/oneOf/1/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                if (vErrors === null) {
                  vErrors = [err18];
                } else {
                  vErrors.push(err18);
                }
                errors++;
              }
            } else {
              const err19 = { instancePath: instancePath + "/attemptId", schemaPath: "#/oneOf/2/oneOf/1/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err19];
              } else {
                vErrors.push(err19);
              }
              errors++;
            }
          }
          var valid7 = _errs34 === errors;
        } else {
          var valid7 = true;
        }
        if (valid7) {
          if (data.parentSnapshotId !== void 0) {
            let data15 = data.parentSnapshotId;
            const _errs36 = errors;
            if (errors === _errs36) {
              if (typeof data15 === "string") {
                if (func2(data15) < 1) {
                  const err20 = { instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/oneOf/2/oneOf/1/properties/parentSnapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err20];
                  } else {
                    vErrors.push(err20);
                  }
                  errors++;
                }
              } else {
                const err21 = { instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/oneOf/2/oneOf/1/properties/parentSnapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err21];
                } else {
                  vErrors.push(err21);
                }
                errors++;
              }
            }
            var valid7 = _errs36 === errors;
          } else {
            var valid7 = true;
          }
        }
      }
    }
    var _valid1 = _errs31 === errors;
    if (_valid1 && valid5) {
      valid5 = false;
      passing1 = [passing1, 1];
    } else {
      if (_valid1) {
        valid5 = true;
        passing1 = 1;
      }
    }
    if (!valid5) {
      const err22 = { instancePath, schemaPath: "#/oneOf/2/oneOf", keyword: "oneOf", params: { passingSchemas: passing1 }, message: "must match exactly one schema in oneOf" };
      if (vErrors === null) {
        vErrors = [err22];
      } else {
        vErrors.push(err22);
      }
      errors++;
    } else {
      errors = _errs23;
      if (vErrors !== null) {
        if (_errs23) {
          vErrors.length = _errs23;
        } else {
          vErrors = null;
        }
      }
    }
    if (errors === _errs22) {
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.source !== void 0) {
          let data16 = data.source;
          const _errs38 = errors;
          if (errors === _errs38) {
            if (data16 && typeof data16 == "object" && !Array.isArray(data16)) {
              if (data16.kind !== void 0) {
                if (!(data16.kind === "manual")) {
                  const err23 = { instancePath: instancePath + "/source/kind", schemaPath: "#/oneOf/2/properties/source/properties/kind/enum", keyword: "enum", params: { allowedValues: schema14.oneOf[2].properties.source.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                  if (vErrors === null) {
                    vErrors = [err23];
                  } else {
                    vErrors.push(err23);
                  }
                  errors++;
                }
              }
            } else {
              const err24 = { instancePath: instancePath + "/source", schemaPath: "#/oneOf/2/properties/source/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err24];
              } else {
                vErrors.push(err24);
              }
              errors++;
            }
          }
        }
      }
    }
    var _valid0 = _errs22 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
      }
    }
  }
  if (!valid0) {
    const err25 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err25];
    } else {
      vErrors.push(err25);
    }
    errors++;
    validate34.errors = vErrors;
    return false;
  } else {
    errors = _errs1;
    if (vErrors !== null) {
      if (_errs1) {
        vErrors.length = _errs1;
      } else {
        vErrors = null;
      }
    }
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.sessionId === void 0 && (missing0 = "sessionId") || data.branchId === void 0 && (missing0 = "branchId") || data.floorId === void 0 && (missing0 = "floorId") || data.attemptId === void 0 && (missing0 = "attemptId") || data.versionId === void 0 && (missing0 = "versionId") || data.snapshotId === void 0 && (missing0 = "snapshotId") || data.parentSnapshotId === void 0 && (missing0 = "parentSnapshotId") || data.variables === void 0 && (missing0 = "variables") || data.source === void 0 && (missing0 = "source")) {
        validate34.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs41 = errors;
        for (const key0 in data) {
          if (!func24.call(schema14.properties, key0)) {
            validate34.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs41 === errors) {
          if (data.sessionId !== void 0) {
            let data18 = data.sessionId;
            const _errs42 = errors;
            if (errors === _errs42) {
              if (typeof data18 === "string") {
                if (func2(data18) < 1) {
                  validate34.errors = [{ instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate34.errors = [{ instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid10 = _errs42 === errors;
          } else {
            var valid10 = true;
          }
          if (valid10) {
            if (data.branchId !== void 0) {
              let data19 = data.branchId;
              const _errs44 = errors;
              if (errors === _errs44) {
                if (typeof data19 === "string") {
                  if (func2(data19) < 1) {
                    validate34.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                } else {
                  validate34.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
              }
              var valid10 = _errs44 === errors;
            } else {
              var valid10 = true;
            }
            if (valid10) {
              if (data.floorId !== void 0) {
                let data20 = data.floorId;
                const _errs46 = errors;
                if (typeof data20 !== "string" && data20 !== null) {
                  validate34.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/type", keyword: "type", params: { type: schema14.properties.floorId.type }, message: "must be string,null" }];
                  return false;
                }
                if (errors === _errs46) {
                  if (typeof data20 === "string") {
                    if (func2(data20) < 1) {
                      validate34.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                      return false;
                    }
                  }
                }
                var valid10 = _errs46 === errors;
              } else {
                var valid10 = true;
              }
              if (valid10) {
                if (data.attemptId !== void 0) {
                  let data21 = data.attemptId;
                  const _errs48 = errors;
                  if (typeof data21 !== "string" && data21 !== null) {
                    validate34.errors = [{ instancePath: instancePath + "/attemptId", schemaPath: "#/properties/attemptId/type", keyword: "type", params: { type: schema14.properties.attemptId.type }, message: "must be string,null" }];
                    return false;
                  }
                  if (errors === _errs48) {
                    if (typeof data21 === "string") {
                      if (func2(data21) < 1) {
                        validate34.errors = [{ instancePath: instancePath + "/attemptId", schemaPath: "#/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                        return false;
                      }
                    }
                  }
                  var valid10 = _errs48 === errors;
                } else {
                  var valid10 = true;
                }
                if (valid10) {
                  if (data.versionId !== void 0) {
                    let data22 = data.versionId;
                    const _errs50 = errors;
                    if (errors === _errs50) {
                      if (typeof data22 === "string") {
                        if (func2(data22) < 1) {
                          validate34.errors = [{ instancePath: instancePath + "/versionId", schemaPath: "#/properties/versionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                          return false;
                        }
                      } else {
                        validate34.errors = [{ instancePath: instancePath + "/versionId", schemaPath: "#/properties/versionId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                        return false;
                      }
                    }
                    var valid10 = _errs50 === errors;
                  } else {
                    var valid10 = true;
                  }
                  if (valid10) {
                    if (data.snapshotId !== void 0) {
                      let data23 = data.snapshotId;
                      const _errs52 = errors;
                      if (errors === _errs52) {
                        if (typeof data23 === "string") {
                          if (func2(data23) < 1) {
                            validate34.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                            return false;
                          }
                        } else {
                          validate34.errors = [{ instancePath: instancePath + "/snapshotId", schemaPath: "#/properties/snapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                          return false;
                        }
                      }
                      var valid10 = _errs52 === errors;
                    } else {
                      var valid10 = true;
                    }
                    if (valid10) {
                      if (data.parentSnapshotId !== void 0) {
                        let data24 = data.parentSnapshotId;
                        const _errs54 = errors;
                        if (typeof data24 !== "string" && data24 !== null) {
                          validate34.errors = [{ instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/properties/parentSnapshotId/type", keyword: "type", params: { type: schema14.properties.parentSnapshotId.type }, message: "must be string,null" }];
                          return false;
                        }
                        if (errors === _errs54) {
                          if (typeof data24 === "string") {
                            if (func2(data24) < 1) {
                              validate34.errors = [{ instancePath: instancePath + "/parentSnapshotId", schemaPath: "#/properties/parentSnapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                              return false;
                            }
                          }
                        }
                        var valid10 = _errs54 === errors;
                      } else {
                        var valid10 = true;
                      }
                      if (valid10) {
                        if (data.variables !== void 0) {
                          let data25 = data.variables;
                          const _errs56 = errors;
                          if (errors === _errs56) {
                            if (data25 && typeof data25 == "object" && !Array.isArray(data25)) {
                            } else {
                              validate34.errors = [{ instancePath: instancePath + "/variables", schemaPath: "#/properties/variables/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                              return false;
                            }
                          }
                          var valid10 = _errs56 === errors;
                        } else {
                          var valid10 = true;
                        }
                        if (valid10) {
                          if (data.source !== void 0) {
                            let data26 = data.source;
                            const _errs59 = errors;
                            const _errs61 = errors;
                            let valid12 = false;
                            let passing2 = null;
                            const _errs62 = errors;
                            if (errors === _errs62) {
                              if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
                                let missing1;
                                if (data26.kind === void 0 && (missing1 = "kind") || data26.runId === void 0 && (missing1 = "runId") || data26.jobId === void 0 && (missing1 = "jobId")) {
                                  const err26 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/0/required", keyword: "required", params: { missingProperty: missing1 }, message: "must have required property '" + missing1 + "'" };
                                  if (vErrors === null) {
                                    vErrors = [err26];
                                  } else {
                                    vErrors.push(err26);
                                  }
                                  errors++;
                                } else {
                                  const _errs64 = errors;
                                  for (const key1 in data26) {
                                    if (!(key1 === "kind" || key1 === "runId" || key1 === "jobId")) {
                                      const err27 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                                      if (vErrors === null) {
                                        vErrors = [err27];
                                      } else {
                                        vErrors.push(err27);
                                      }
                                      errors++;
                                      break;
                                    }
                                  }
                                  if (_errs64 === errors) {
                                    if (data26.kind !== void 0) {
                                      const _errs65 = errors;
                                      if ("initial" !== data26.kind) {
                                        const err28 = { instancePath: instancePath + "/source/kind", schemaPath: "#/definitions/snapshotSource/oneOf/0/properties/kind/const", keyword: "const", params: { allowedValue: "initial" }, message: "must be equal to constant" };
                                        if (vErrors === null) {
                                          vErrors = [err28];
                                        } else {
                                          vErrors.push(err28);
                                        }
                                        errors++;
                                      }
                                      var valid13 = _errs65 === errors;
                                    } else {
                                      var valid13 = true;
                                    }
                                    if (valid13) {
                                      if (data26.runId !== void 0) {
                                        const _errs66 = errors;
                                        if (data26.runId !== null) {
                                          const err29 = { instancePath: instancePath + "/source/runId", schemaPath: "#/definitions/snapshotSource/oneOf/0/properties/runId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                          if (vErrors === null) {
                                            vErrors = [err29];
                                          } else {
                                            vErrors.push(err29);
                                          }
                                          errors++;
                                        }
                                        var valid13 = _errs66 === errors;
                                      } else {
                                        var valid13 = true;
                                      }
                                      if (valid13) {
                                        if (data26.jobId !== void 0) {
                                          const _errs68 = errors;
                                          if (data26.jobId !== null) {
                                            const err30 = { instancePath: instancePath + "/source/jobId", schemaPath: "#/definitions/snapshotSource/oneOf/0/properties/jobId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                            if (vErrors === null) {
                                              vErrors = [err30];
                                            } else {
                                              vErrors.push(err30);
                                            }
                                            errors++;
                                          }
                                          var valid13 = _errs68 === errors;
                                        } else {
                                          var valid13 = true;
                                        }
                                      }
                                    }
                                  }
                                }
                              } else {
                                const err31 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                if (vErrors === null) {
                                  vErrors = [err31];
                                } else {
                                  vErrors.push(err31);
                                }
                                errors++;
                              }
                            }
                            var _valid2 = _errs62 === errors;
                            if (_valid2) {
                              valid12 = true;
                              passing2 = 0;
                            }
                            const _errs70 = errors;
                            if (errors === _errs70) {
                              if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
                                let missing2;
                                if (data26.kind === void 0 && (missing2 = "kind") || data26.runId === void 0 && (missing2 = "runId") || data26.jobId === void 0 && (missing2 = "jobId")) {
                                  const err32 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/1/required", keyword: "required", params: { missingProperty: missing2 }, message: "must have required property '" + missing2 + "'" };
                                  if (vErrors === null) {
                                    vErrors = [err32];
                                  } else {
                                    vErrors.push(err32);
                                  }
                                  errors++;
                                } else {
                                  const _errs72 = errors;
                                  for (const key2 in data26) {
                                    if (!(key2 === "kind" || key2 === "runId" || key2 === "jobId")) {
                                      const err33 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                                      if (vErrors === null) {
                                        vErrors = [err33];
                                      } else {
                                        vErrors.push(err33);
                                      }
                                      errors++;
                                      break;
                                    }
                                  }
                                  if (_errs72 === errors) {
                                    if (data26.kind !== void 0) {
                                      const _errs73 = errors;
                                      if ("floor" !== data26.kind) {
                                        const err34 = { instancePath: instancePath + "/source/kind", schemaPath: "#/definitions/snapshotSource/oneOf/1/properties/kind/const", keyword: "const", params: { allowedValue: "floor" }, message: "must be equal to constant" };
                                        if (vErrors === null) {
                                          vErrors = [err34];
                                        } else {
                                          vErrors.push(err34);
                                        }
                                        errors++;
                                      }
                                      var valid14 = _errs73 === errors;
                                    } else {
                                      var valid14 = true;
                                    }
                                    if (valid14) {
                                      if (data26.runId !== void 0) {
                                        let data31 = data26.runId;
                                        const _errs74 = errors;
                                        if (errors === _errs74) {
                                          if (typeof data31 === "string") {
                                            if (func2(data31) < 1) {
                                              const err35 = { instancePath: instancePath + "/source/runId", schemaPath: "#/definitions/snapshotSource/oneOf/1/properties/runId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                              if (vErrors === null) {
                                                vErrors = [err35];
                                              } else {
                                                vErrors.push(err35);
                                              }
                                              errors++;
                                            }
                                          } else {
                                            const err36 = { instancePath: instancePath + "/source/runId", schemaPath: "#/definitions/snapshotSource/oneOf/1/properties/runId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                            if (vErrors === null) {
                                              vErrors = [err36];
                                            } else {
                                              vErrors.push(err36);
                                            }
                                            errors++;
                                          }
                                        }
                                        var valid14 = _errs74 === errors;
                                      } else {
                                        var valid14 = true;
                                      }
                                      if (valid14) {
                                        if (data26.jobId !== void 0) {
                                          const _errs76 = errors;
                                          if (data26.jobId !== null) {
                                            const err37 = { instancePath: instancePath + "/source/jobId", schemaPath: "#/definitions/snapshotSource/oneOf/1/properties/jobId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                            if (vErrors === null) {
                                              vErrors = [err37];
                                            } else {
                                              vErrors.push(err37);
                                            }
                                            errors++;
                                          }
                                          var valid14 = _errs76 === errors;
                                        } else {
                                          var valid14 = true;
                                        }
                                      }
                                    }
                                  }
                                }
                              } else {
                                const err38 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                if (vErrors === null) {
                                  vErrors = [err38];
                                } else {
                                  vErrors.push(err38);
                                }
                                errors++;
                              }
                            }
                            var _valid2 = _errs70 === errors;
                            if (_valid2 && valid12) {
                              valid12 = false;
                              passing2 = [passing2, 1];
                            } else {
                              if (_valid2) {
                                valid12 = true;
                                passing2 = 1;
                              }
                              const _errs78 = errors;
                              if (errors === _errs78) {
                                if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
                                  let missing3;
                                  if (data26.kind === void 0 && (missing3 = "kind") || data26.runId === void 0 && (missing3 = "runId") || data26.jobId === void 0 && (missing3 = "jobId")) {
                                    const err39 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/2/required", keyword: "required", params: { missingProperty: missing3 }, message: "must have required property '" + missing3 + "'" };
                                    if (vErrors === null) {
                                      vErrors = [err39];
                                    } else {
                                      vErrors.push(err39);
                                    }
                                    errors++;
                                  } else {
                                    const _errs80 = errors;
                                    for (const key3 in data26) {
                                      if (!(key3 === "kind" || key3 === "runId" || key3 === "jobId")) {
                                        const err40 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/2/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
                                        if (vErrors === null) {
                                          vErrors = [err40];
                                        } else {
                                          vErrors.push(err40);
                                        }
                                        errors++;
                                        break;
                                      }
                                    }
                                    if (_errs80 === errors) {
                                      if (data26.kind !== void 0) {
                                        const _errs81 = errors;
                                        if ("job" !== data26.kind) {
                                          const err41 = { instancePath: instancePath + "/source/kind", schemaPath: "#/definitions/snapshotSource/oneOf/2/properties/kind/const", keyword: "const", params: { allowedValue: "job" }, message: "must be equal to constant" };
                                          if (vErrors === null) {
                                            vErrors = [err41];
                                          } else {
                                            vErrors.push(err41);
                                          }
                                          errors++;
                                        }
                                        var valid15 = _errs81 === errors;
                                      } else {
                                        var valid15 = true;
                                      }
                                      if (valid15) {
                                        if (data26.runId !== void 0) {
                                          let data34 = data26.runId;
                                          const _errs82 = errors;
                                          if (typeof data34 !== "string" && data34 !== null) {
                                            const err42 = { instancePath: instancePath + "/source/runId", schemaPath: "#/definitions/snapshotSource/oneOf/2/properties/runId/type", keyword: "type", params: { type: schema15.oneOf[2].properties.runId.type }, message: "must be string,null" };
                                            if (vErrors === null) {
                                              vErrors = [err42];
                                            } else {
                                              vErrors.push(err42);
                                            }
                                            errors++;
                                          }
                                          if (errors === _errs82) {
                                            if (typeof data34 === "string") {
                                              if (func2(data34) < 1) {
                                                const err43 = { instancePath: instancePath + "/source/runId", schemaPath: "#/definitions/snapshotSource/oneOf/2/properties/runId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                                if (vErrors === null) {
                                                  vErrors = [err43];
                                                } else {
                                                  vErrors.push(err43);
                                                }
                                                errors++;
                                              }
                                            }
                                          }
                                          var valid15 = _errs82 === errors;
                                        } else {
                                          var valid15 = true;
                                        }
                                        if (valid15) {
                                          if (data26.jobId !== void 0) {
                                            let data35 = data26.jobId;
                                            const _errs84 = errors;
                                            if (errors === _errs84) {
                                              if (typeof data35 === "string") {
                                                if (func2(data35) < 1) {
                                                  const err44 = { instancePath: instancePath + "/source/jobId", schemaPath: "#/definitions/snapshotSource/oneOf/2/properties/jobId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                                  if (vErrors === null) {
                                                    vErrors = [err44];
                                                  } else {
                                                    vErrors.push(err44);
                                                  }
                                                  errors++;
                                                }
                                              } else {
                                                const err45 = { instancePath: instancePath + "/source/jobId", schemaPath: "#/definitions/snapshotSource/oneOf/2/properties/jobId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                                if (vErrors === null) {
                                                  vErrors = [err45];
                                                } else {
                                                  vErrors.push(err45);
                                                }
                                                errors++;
                                              }
                                            }
                                            var valid15 = _errs84 === errors;
                                          } else {
                                            var valid15 = true;
                                          }
                                        }
                                      }
                                    }
                                  }
                                } else {
                                  const err46 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/2/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                  if (vErrors === null) {
                                    vErrors = [err46];
                                  } else {
                                    vErrors.push(err46);
                                  }
                                  errors++;
                                }
                              }
                              var _valid2 = _errs78 === errors;
                              if (_valid2 && valid12) {
                                valid12 = false;
                                passing2 = [passing2, 2];
                              } else {
                                if (_valid2) {
                                  valid12 = true;
                                  passing2 = 2;
                                }
                                const _errs86 = errors;
                                if (errors === _errs86) {
                                  if (data26 && typeof data26 == "object" && !Array.isArray(data26)) {
                                    let missing4;
                                    if (data26.kind === void 0 && (missing4 = "kind") || data26.runId === void 0 && (missing4 = "runId") || data26.jobId === void 0 && (missing4 = "jobId")) {
                                      const err47 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/3/required", keyword: "required", params: { missingProperty: missing4 }, message: "must have required property '" + missing4 + "'" };
                                      if (vErrors === null) {
                                        vErrors = [err47];
                                      } else {
                                        vErrors.push(err47);
                                      }
                                      errors++;
                                    } else {
                                      const _errs88 = errors;
                                      for (const key4 in data26) {
                                        if (!(key4 === "kind" || key4 === "runId" || key4 === "jobId")) {
                                          const err48 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/3/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
                                          if (vErrors === null) {
                                            vErrors = [err48];
                                          } else {
                                            vErrors.push(err48);
                                          }
                                          errors++;
                                          break;
                                        }
                                      }
                                      if (_errs88 === errors) {
                                        if (data26.kind !== void 0) {
                                          const _errs89 = errors;
                                          if ("manual" !== data26.kind) {
                                            const err49 = { instancePath: instancePath + "/source/kind", schemaPath: "#/definitions/snapshotSource/oneOf/3/properties/kind/const", keyword: "const", params: { allowedValue: "manual" }, message: "must be equal to constant" };
                                            if (vErrors === null) {
                                              vErrors = [err49];
                                            } else {
                                              vErrors.push(err49);
                                            }
                                            errors++;
                                          }
                                          var valid16 = _errs89 === errors;
                                        } else {
                                          var valid16 = true;
                                        }
                                        if (valid16) {
                                          if (data26.runId !== void 0) {
                                            const _errs90 = errors;
                                            if (data26.runId !== null) {
                                              const err50 = { instancePath: instancePath + "/source/runId", schemaPath: "#/definitions/snapshotSource/oneOf/3/properties/runId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                              if (vErrors === null) {
                                                vErrors = [err50];
                                              } else {
                                                vErrors.push(err50);
                                              }
                                              errors++;
                                            }
                                            var valid16 = _errs90 === errors;
                                          } else {
                                            var valid16 = true;
                                          }
                                          if (valid16) {
                                            if (data26.jobId !== void 0) {
                                              const _errs92 = errors;
                                              if (data26.jobId !== null) {
                                                const err51 = { instancePath: instancePath + "/source/jobId", schemaPath: "#/definitions/snapshotSource/oneOf/3/properties/jobId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                                if (vErrors === null) {
                                                  vErrors = [err51];
                                                } else {
                                                  vErrors.push(err51);
                                                }
                                                errors++;
                                              }
                                              var valid16 = _errs92 === errors;
                                            } else {
                                              var valid16 = true;
                                            }
                                          }
                                        }
                                      }
                                    }
                                  } else {
                                    const err52 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf/3/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                    if (vErrors === null) {
                                      vErrors = [err52];
                                    } else {
                                      vErrors.push(err52);
                                    }
                                    errors++;
                                  }
                                }
                                var _valid2 = _errs86 === errors;
                                if (_valid2 && valid12) {
                                  valid12 = false;
                                  passing2 = [passing2, 3];
                                } else {
                                  if (_valid2) {
                                    valid12 = true;
                                    passing2 = 3;
                                  }
                                }
                              }
                            }
                            if (!valid12) {
                              const err53 = { instancePath: instancePath + "/source", schemaPath: "#/definitions/snapshotSource/oneOf", keyword: "oneOf", params: { passingSchemas: passing2 }, message: "must match exactly one schema in oneOf" };
                              if (vErrors === null) {
                                vErrors = [err53];
                              } else {
                                vErrors.push(err53);
                              }
                              errors++;
                              validate34.errors = vErrors;
                              return false;
                            } else {
                              errors = _errs61;
                              if (vErrors !== null) {
                                if (_errs61) {
                                  vErrors.length = _errs61;
                                } else {
                                  vErrors = null;
                                }
                              }
                            }
                            var valid10 = _errs59 === errors;
                          } else {
                            var valid10 = true;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate34.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate34.errors = vErrors;
  return errors === 0;
}
var historyListFloorsParams = validate35;
function validate35(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.branchId === void 0 && (missing0 = "branchId")) {
        validate35.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "branchId" || key0 === "cursor" || key0 === "limit")) {
            validate35.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.branchId !== void 0) {
            let data0 = data.branchId;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate35.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate35.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.cursor !== void 0) {
              let data1 = data.cursor;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (typeof data1 === "string") {
                  if (func2(data1) < 1) {
                    validate35.errors = [{ instancePath: instancePath + "/cursor", schemaPath: "#/properties/cursor/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                } else {
                  validate35.errors = [{ instancePath: instancePath + "/cursor", schemaPath: "#/properties/cursor/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.limit !== void 0) {
                let data2 = data.limit;
                const _errs6 = errors;
                if (!(typeof data2 == "number" && (!(data2 % 1) && !isNaN(data2)) && isFinite(data2))) {
                  validate35.errors = [{ instancePath: instancePath + "/limit", schemaPath: "#/properties/limit/type", keyword: "type", params: { type: "integer" }, message: "must be integer" }];
                  return false;
                }
                if (errors === _errs6) {
                  if (typeof data2 == "number" && isFinite(data2)) {
                    if (data2 > 100 || isNaN(data2)) {
                      validate35.errors = [{ instancePath: instancePath + "/limit", schemaPath: "#/properties/limit/maximum", keyword: "maximum", params: { comparison: "<=", limit: 100 }, message: "must be <= 100" }];
                      return false;
                    } else {
                      if (data2 < 1 || isNaN(data2)) {
                        validate35.errors = [{ instancePath: instancePath + "/limit", schemaPath: "#/properties/limit/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" }];
                        return false;
                      }
                    }
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate35.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate35.errors = vErrors;
  return errors === 0;
}
var historyListFloorsResult = validate36;
function validate36(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.items === void 0 && (missing0 = "items") || data.nextCursor === void 0 && (missing0 = "nextCursor")) {
        validate36.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "items" || key0 === "nextCursor")) {
            validate36.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.items !== void 0) {
            let data0 = data.items;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (Array.isArray(data0)) {
                var valid1 = true;
                const len0 = data0.length;
                for (let i0 = 0; i0 < len0; i0++) {
                  let data1 = data0[i0];
                  const _errs4 = errors;
                  if (errors === _errs4) {
                    if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                      let missing1;
                      if (data1.floorId === void 0 && (missing1 = "floorId") || data1.attemptId === void 0 && (missing1 = "attemptId") || data1.snapshotId === void 0 && (missing1 = "snapshotId")) {
                        validate36.errors = [{ instancePath: instancePath + "/items/" + i0, schemaPath: "#/properties/items/items/required", keyword: "required", params: { missingProperty: missing1 }, message: "must have required property '" + missing1 + "'" }];
                        return false;
                      } else {
                        const _errs6 = errors;
                        for (const key1 in data1) {
                          if (!(key1 === "floorId" || key1 === "attemptId" || key1 === "snapshotId")) {
                            validate36.errors = [{ instancePath: instancePath + "/items/" + i0, schemaPath: "#/properties/items/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                            return false;
                            break;
                          }
                        }
                        if (_errs6 === errors) {
                          if (data1.floorId !== void 0) {
                            let data2 = data1.floorId;
                            const _errs7 = errors;
                            if (errors === _errs7) {
                              if (typeof data2 === "string") {
                                if (func2(data2) < 1) {
                                  validate36.errors = [{ instancePath: instancePath + "/items/" + i0 + "/floorId", schemaPath: "#/properties/items/items/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                  return false;
                                }
                              } else {
                                validate36.errors = [{ instancePath: instancePath + "/items/" + i0 + "/floorId", schemaPath: "#/properties/items/items/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                return false;
                              }
                            }
                            var valid2 = _errs7 === errors;
                          } else {
                            var valid2 = true;
                          }
                          if (valid2) {
                            if (data1.attemptId !== void 0) {
                              let data3 = data1.attemptId;
                              const _errs9 = errors;
                              if (errors === _errs9) {
                                if (typeof data3 === "string") {
                                  if (func2(data3) < 1) {
                                    validate36.errors = [{ instancePath: instancePath + "/items/" + i0 + "/attemptId", schemaPath: "#/properties/items/items/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                    return false;
                                  }
                                } else {
                                  validate36.errors = [{ instancePath: instancePath + "/items/" + i0 + "/attemptId", schemaPath: "#/properties/items/items/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                  return false;
                                }
                              }
                              var valid2 = _errs9 === errors;
                            } else {
                              var valid2 = true;
                            }
                            if (valid2) {
                              if (data1.snapshotId !== void 0) {
                                let data4 = data1.snapshotId;
                                const _errs11 = errors;
                                if (errors === _errs11) {
                                  if (typeof data4 === "string") {
                                    if (func2(data4) < 1) {
                                      validate36.errors = [{ instancePath: instancePath + "/items/" + i0 + "/snapshotId", schemaPath: "#/properties/items/items/properties/snapshotId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                      return false;
                                    }
                                  } else {
                                    validate36.errors = [{ instancePath: instancePath + "/items/" + i0 + "/snapshotId", schemaPath: "#/properties/items/items/properties/snapshotId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                    return false;
                                  }
                                }
                                var valid2 = _errs11 === errors;
                              } else {
                                var valid2 = true;
                              }
                            }
                          }
                        }
                      }
                    } else {
                      validate36.errors = [{ instancePath: instancePath + "/items/" + i0, schemaPath: "#/properties/items/items/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                      return false;
                    }
                  }
                  var valid1 = _errs4 === errors;
                  if (!valid1) {
                    break;
                  }
                }
              } else {
                validate36.errors = [{ instancePath: instancePath + "/items", schemaPath: "#/properties/items/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.nextCursor !== void 0) {
              let data5 = data.nextCursor;
              const _errs13 = errors;
              if (typeof data5 !== "string" && data5 !== null) {
                validate36.errors = [{ instancePath: instancePath + "/nextCursor", schemaPath: "#/properties/nextCursor/type", keyword: "type", params: { type: schema19.properties.nextCursor.type }, message: "must be string,null" }];
                return false;
              }
              if (errors === _errs13) {
                if (typeof data5 === "string") {
                  if (func2(data5) < 1) {
                    validate36.errors = [{ instancePath: instancePath + "/nextCursor", schemaPath: "#/properties/nextCursor/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                }
              }
              var valid0 = _errs13 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate36.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate36.errors = vErrors;
  return errors === 0;
}
var layoutRegistration = validate37;
var schema35 = { "type": "object", "properties": { "root": { "type": "string", "minLength": 1 }, "elements": { "type": "object", "minProperties": 1, "additionalProperties": { "type": "object", "properties": { "selector": { "type": "string", "minLength": 1 }, "kind": { "enum": ["image", "text", "progress", "control", "container"] } }, "required": ["selector", "kind"], "additionalProperties": false } } }, "required": ["elements"], "additionalProperties": false };
function validate37(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.elements === void 0 && (missing0 = "elements")) {
        validate37.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "root" || key0 === "elements")) {
            validate37.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.root !== void 0) {
            let data0 = data.root;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate37.errors = [{ instancePath: instancePath + "/root", schemaPath: "#/properties/root/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate37.errors = [{ instancePath: instancePath + "/root", schemaPath: "#/properties/root/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.elements !== void 0) {
              let data1 = data.elements;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                  if (Object.keys(data1).length < 1) {
                    validate37.errors = [{ instancePath: instancePath + "/elements", schemaPath: "#/properties/elements/minProperties", keyword: "minProperties", params: { limit: 1 }, message: "must NOT have fewer than 1 properties" }];
                    return false;
                  } else {
                    for (const key1 in data1) {
                      let data2 = data1[key1];
                      const _errs7 = errors;
                      if (errors === _errs7) {
                        if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
                          let missing1;
                          if (data2.selector === void 0 && (missing1 = "selector") || data2.kind === void 0 && (missing1 = "kind")) {
                            validate37.errors = [{ instancePath: instancePath + "/elements/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/elements/additionalProperties/required", keyword: "required", params: { missingProperty: missing1 }, message: "must have required property '" + missing1 + "'" }];
                            return false;
                          } else {
                            const _errs9 = errors;
                            for (const key2 in data2) {
                              if (!(key2 === "selector" || key2 === "kind")) {
                                validate37.errors = [{ instancePath: instancePath + "/elements/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/elements/additionalProperties/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                                return false;
                                break;
                              }
                            }
                            if (_errs9 === errors) {
                              if (data2.selector !== void 0) {
                                let data3 = data2.selector;
                                const _errs10 = errors;
                                if (errors === _errs10) {
                                  if (typeof data3 === "string") {
                                    if (func2(data3) < 1) {
                                      validate37.errors = [{ instancePath: instancePath + "/elements/" + key1.replace(/~/g, "~0").replace(/\//g, "~1") + "/selector", schemaPath: "#/properties/elements/additionalProperties/properties/selector/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                      return false;
                                    }
                                  } else {
                                    validate37.errors = [{ instancePath: instancePath + "/elements/" + key1.replace(/~/g, "~0").replace(/\//g, "~1") + "/selector", schemaPath: "#/properties/elements/additionalProperties/properties/selector/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                    return false;
                                  }
                                }
                                var valid2 = _errs10 === errors;
                              } else {
                                var valid2 = true;
                              }
                              if (valid2) {
                                if (data2.kind !== void 0) {
                                  let data4 = data2.kind;
                                  const _errs12 = errors;
                                  if (!(data4 === "image" || data4 === "text" || data4 === "progress" || data4 === "control" || data4 === "container")) {
                                    validate37.errors = [{ instancePath: instancePath + "/elements/" + key1.replace(/~/g, "~0").replace(/\//g, "~1") + "/kind", schemaPath: "#/properties/elements/additionalProperties/properties/kind/enum", keyword: "enum", params: { allowedValues: schema35.properties.elements.additionalProperties.properties.kind.enum }, message: "must be equal to one of the allowed values" }];
                                    return false;
                                  }
                                  var valid2 = _errs12 === errors;
                                } else {
                                  var valid2 = true;
                                }
                              }
                            }
                          }
                        } else {
                          validate37.errors = [{ instancePath: instancePath + "/elements/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/elements/additionalProperties/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                          return false;
                        }
                      }
                      var valid1 = _errs7 === errors;
                      if (!valid1) {
                        break;
                      }
                    }
                  }
                } else {
                  validate37.errors = [{ instancePath: instancePath + "/elements", schemaPath: "#/properties/elements/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                  return false;
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate37.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate37.errors = vErrors;
  return errors === 0;
}
var elementUpdate = validate38;
var schema36 = { "type": "object", "properties": { "visible": { "type": "boolean" }, "classes": { "type": "object", "additionalProperties": { "type": "boolean" } }, "asset": { "type": "string", "minLength": 1 }, "alt": { "type": "string" }, "text": { "type": "string" }, "value": { "anyOf": [{ "type": "number" }, { "type": "string" }] }, "min": { "type": "number" }, "max": { "type": "number" }, "disabled": { "type": "boolean" }, "checked": { "type": "boolean" } }, "required": [], "additionalProperties": false };
function validate38(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      const _errs1 = errors;
      for (const key0 in data) {
        if (!func24.call(schema36.properties, key0)) {
          validate38.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
          return false;
          break;
        }
      }
      if (_errs1 === errors) {
        if (data.visible !== void 0) {
          const _errs2 = errors;
          if (typeof data.visible !== "boolean") {
            validate38.errors = [{ instancePath: instancePath + "/visible", schemaPath: "#/properties/visible/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" }];
            return false;
          }
          var valid0 = _errs2 === errors;
        } else {
          var valid0 = true;
        }
        if (valid0) {
          if (data.classes !== void 0) {
            let data1 = data.classes;
            const _errs4 = errors;
            if (errors === _errs4) {
              if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                for (const key1 in data1) {
                  const _errs7 = errors;
                  if (typeof data1[key1] !== "boolean") {
                    validate38.errors = [{ instancePath: instancePath + "/classes/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/classes/additionalProperties/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" }];
                    return false;
                  }
                  var valid1 = _errs7 === errors;
                  if (!valid1) {
                    break;
                  }
                }
              } else {
                validate38.errors = [{ instancePath: instancePath + "/classes", schemaPath: "#/properties/classes/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                return false;
              }
            }
            var valid0 = _errs4 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.asset !== void 0) {
              let data3 = data.asset;
              const _errs9 = errors;
              if (errors === _errs9) {
                if (typeof data3 === "string") {
                  if (func2(data3) < 1) {
                    validate38.errors = [{ instancePath: instancePath + "/asset", schemaPath: "#/properties/asset/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                } else {
                  validate38.errors = [{ instancePath: instancePath + "/asset", schemaPath: "#/properties/asset/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
              }
              var valid0 = _errs9 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.alt !== void 0) {
                const _errs11 = errors;
                if (typeof data.alt !== "string") {
                  validate38.errors = [{ instancePath: instancePath + "/alt", schemaPath: "#/properties/alt/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
                var valid0 = _errs11 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.text !== void 0) {
                  const _errs13 = errors;
                  if (typeof data.text !== "string") {
                    validate38.errors = [{ instancePath: instancePath + "/text", schemaPath: "#/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                    return false;
                  }
                  var valid0 = _errs13 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.value !== void 0) {
                    let data6 = data.value;
                    const _errs15 = errors;
                    const _errs16 = errors;
                    let valid2 = false;
                    const _errs17 = errors;
                    if (!(typeof data6 == "number" && isFinite(data6))) {
                      const err0 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/anyOf/0/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                      if (vErrors === null) {
                        vErrors = [err0];
                      } else {
                        vErrors.push(err0);
                      }
                      errors++;
                    }
                    var _valid0 = _errs17 === errors;
                    valid2 = valid2 || _valid0;
                    if (!valid2) {
                      const _errs19 = errors;
                      if (typeof data6 !== "string") {
                        const err1 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/anyOf/1/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        if (vErrors === null) {
                          vErrors = [err1];
                        } else {
                          vErrors.push(err1);
                        }
                        errors++;
                      }
                      var _valid0 = _errs19 === errors;
                      valid2 = valid2 || _valid0;
                    }
                    if (!valid2) {
                      const err2 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                      if (vErrors === null) {
                        vErrors = [err2];
                      } else {
                        vErrors.push(err2);
                      }
                      errors++;
                      validate38.errors = vErrors;
                      return false;
                    } else {
                      errors = _errs16;
                      if (vErrors !== null) {
                        if (_errs16) {
                          vErrors.length = _errs16;
                        } else {
                          vErrors = null;
                        }
                      }
                    }
                    var valid0 = _errs15 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.min !== void 0) {
                      let data7 = data.min;
                      const _errs21 = errors;
                      if (!(typeof data7 == "number" && isFinite(data7))) {
                        validate38.errors = [{ instancePath: instancePath + "/min", schemaPath: "#/properties/min/type", keyword: "type", params: { type: "number" }, message: "must be number" }];
                        return false;
                      }
                      var valid0 = _errs21 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.max !== void 0) {
                        let data8 = data.max;
                        const _errs23 = errors;
                        if (!(typeof data8 == "number" && isFinite(data8))) {
                          validate38.errors = [{ instancePath: instancePath + "/max", schemaPath: "#/properties/max/type", keyword: "type", params: { type: "number" }, message: "must be number" }];
                          return false;
                        }
                        var valid0 = _errs23 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.disabled !== void 0) {
                          const _errs25 = errors;
                          if (typeof data.disabled !== "boolean") {
                            validate38.errors = [{ instancePath: instancePath + "/disabled", schemaPath: "#/properties/disabled/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" }];
                            return false;
                          }
                          var valid0 = _errs25 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.checked !== void 0) {
                            const _errs27 = errors;
                            if (typeof data.checked !== "boolean") {
                              validate38.errors = [{ instancePath: instancePath + "/checked", schemaPath: "#/properties/checked/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" }];
                              return false;
                            }
                            var valid0 = _errs27 === errors;
                          } else {
                            var valid0 = true;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate38.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate38.errors = vErrors;
  return errors === 0;
}
var layoutPatch = validate39;
function validate39(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      for (const key0 in data) {
        let data0 = data[key0];
        const _errs2 = errors;
        const _errs3 = errors;
        if (errors === _errs3) {
          if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
            const _errs5 = errors;
            for (const key1 in data0) {
              if (!func24.call(schema36.properties, key1)) {
                validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/elementUpdate/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                return false;
                break;
              }
            }
            if (_errs5 === errors) {
              if (data0.visible !== void 0) {
                const _errs6 = errors;
                if (typeof data0.visible !== "boolean") {
                  validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/visible", schemaPath: "#/definitions/elementUpdate/properties/visible/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" }];
                  return false;
                }
                var valid2 = _errs6 === errors;
              } else {
                var valid2 = true;
              }
              if (valid2) {
                if (data0.classes !== void 0) {
                  let data2 = data0.classes;
                  const _errs8 = errors;
                  if (errors === _errs8) {
                    if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
                      for (const key2 in data2) {
                        const _errs11 = errors;
                        if (typeof data2[key2] !== "boolean") {
                          validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/classes/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/elementUpdate/properties/classes/additionalProperties/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" }];
                          return false;
                        }
                        var valid3 = _errs11 === errors;
                        if (!valid3) {
                          break;
                        }
                      }
                    } else {
                      validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/classes", schemaPath: "#/definitions/elementUpdate/properties/classes/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                      return false;
                    }
                  }
                  var valid2 = _errs8 === errors;
                } else {
                  var valid2 = true;
                }
                if (valid2) {
                  if (data0.asset !== void 0) {
                    let data4 = data0.asset;
                    const _errs13 = errors;
                    if (errors === _errs13) {
                      if (typeof data4 === "string") {
                        if (func2(data4) < 1) {
                          validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/asset", schemaPath: "#/definitions/elementUpdate/properties/asset/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                          return false;
                        }
                      } else {
                        validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/asset", schemaPath: "#/definitions/elementUpdate/properties/asset/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                        return false;
                      }
                    }
                    var valid2 = _errs13 === errors;
                  } else {
                    var valid2 = true;
                  }
                  if (valid2) {
                    if (data0.alt !== void 0) {
                      const _errs15 = errors;
                      if (typeof data0.alt !== "string") {
                        validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/alt", schemaPath: "#/definitions/elementUpdate/properties/alt/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                        return false;
                      }
                      var valid2 = _errs15 === errors;
                    } else {
                      var valid2 = true;
                    }
                    if (valid2) {
                      if (data0.text !== void 0) {
                        const _errs17 = errors;
                        if (typeof data0.text !== "string") {
                          validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/text", schemaPath: "#/definitions/elementUpdate/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                          return false;
                        }
                        var valid2 = _errs17 === errors;
                      } else {
                        var valid2 = true;
                      }
                      if (valid2) {
                        if (data0.value !== void 0) {
                          let data7 = data0.value;
                          const _errs19 = errors;
                          const _errs20 = errors;
                          let valid4 = false;
                          const _errs21 = errors;
                          if (!(typeof data7 == "number" && isFinite(data7))) {
                            const err0 = { instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/value", schemaPath: "#/definitions/elementUpdate/properties/value/anyOf/0/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                            if (vErrors === null) {
                              vErrors = [err0];
                            } else {
                              vErrors.push(err0);
                            }
                            errors++;
                          }
                          var _valid0 = _errs21 === errors;
                          valid4 = valid4 || _valid0;
                          if (!valid4) {
                            const _errs23 = errors;
                            if (typeof data7 !== "string") {
                              const err1 = { instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/value", schemaPath: "#/definitions/elementUpdate/properties/value/anyOf/1/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                              if (vErrors === null) {
                                vErrors = [err1];
                              } else {
                                vErrors.push(err1);
                              }
                              errors++;
                            }
                            var _valid0 = _errs23 === errors;
                            valid4 = valid4 || _valid0;
                          }
                          if (!valid4) {
                            const err2 = { instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/value", schemaPath: "#/definitions/elementUpdate/properties/value/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                            if (vErrors === null) {
                              vErrors = [err2];
                            } else {
                              vErrors.push(err2);
                            }
                            errors++;
                            validate39.errors = vErrors;
                            return false;
                          } else {
                            errors = _errs20;
                            if (vErrors !== null) {
                              if (_errs20) {
                                vErrors.length = _errs20;
                              } else {
                                vErrors = null;
                              }
                            }
                          }
                          var valid2 = _errs19 === errors;
                        } else {
                          var valid2 = true;
                        }
                        if (valid2) {
                          if (data0.min !== void 0) {
                            let data8 = data0.min;
                            const _errs25 = errors;
                            if (!(typeof data8 == "number" && isFinite(data8))) {
                              validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/min", schemaPath: "#/definitions/elementUpdate/properties/min/type", keyword: "type", params: { type: "number" }, message: "must be number" }];
                              return false;
                            }
                            var valid2 = _errs25 === errors;
                          } else {
                            var valid2 = true;
                          }
                          if (valid2) {
                            if (data0.max !== void 0) {
                              let data9 = data0.max;
                              const _errs27 = errors;
                              if (!(typeof data9 == "number" && isFinite(data9))) {
                                validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/max", schemaPath: "#/definitions/elementUpdate/properties/max/type", keyword: "type", params: { type: "number" }, message: "must be number" }];
                                return false;
                              }
                              var valid2 = _errs27 === errors;
                            } else {
                              var valid2 = true;
                            }
                            if (valid2) {
                              if (data0.disabled !== void 0) {
                                const _errs29 = errors;
                                if (typeof data0.disabled !== "boolean") {
                                  validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/disabled", schemaPath: "#/definitions/elementUpdate/properties/disabled/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" }];
                                  return false;
                                }
                                var valid2 = _errs29 === errors;
                              } else {
                                var valid2 = true;
                              }
                              if (valid2) {
                                if (data0.checked !== void 0) {
                                  const _errs31 = errors;
                                  if (typeof data0.checked !== "boolean") {
                                    validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1") + "/checked", schemaPath: "#/definitions/elementUpdate/properties/checked/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" }];
                                    return false;
                                  }
                                  var valid2 = _errs31 === errors;
                                } else {
                                  var valid2 = true;
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          } else {
            validate39.errors = [{ instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/definitions/elementUpdate/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
            return false;
          }
        }
        var valid0 = _errs2 === errors;
        if (!valid0) {
          break;
        }
      }
    } else {
      validate39.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate39.errors = vErrors;
  return errors === 0;
}
var assetsListParams = validate40;
var schema39 = { "type": "object", "properties": { "kind": { "enum": ["image", "audio"] }, "tag": { "type": "string", "minLength": 1 } }, "required": [], "additionalProperties": false };
function validate40(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      const _errs1 = errors;
      for (const key0 in data) {
        if (!(key0 === "kind" || key0 === "tag")) {
          validate40.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
          return false;
          break;
        }
      }
      if (_errs1 === errors) {
        if (data.kind !== void 0) {
          let data0 = data.kind;
          const _errs2 = errors;
          if (!(data0 === "image" || data0 === "audio")) {
            validate40.errors = [{ instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema39.properties.kind.enum }, message: "must be equal to one of the allowed values" }];
            return false;
          }
          var valid0 = _errs2 === errors;
        } else {
          var valid0 = true;
        }
        if (valid0) {
          if (data.tag !== void 0) {
            let data1 = data.tag;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data1 === "string") {
                if (func2(data1) < 1) {
                  validate40.errors = [{ instancePath: instancePath + "/tag", schemaPath: "#/properties/tag/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate40.errors = [{ instancePath: instancePath + "/tag", schemaPath: "#/properties/tag/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid0 = _errs3 === errors;
          } else {
            var valid0 = true;
          }
        }
      }
    } else {
      validate40.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate40.errors = vErrors;
  return errors === 0;
}
var assetMetadata = validate41;
var schema40 = { "type": "object", "properties": { "id": { "type": "string", "minLength": 1 }, "kind": { "enum": ["image", "audio"] }, "label": { "type": "string", "minLength": 1 }, "tags": { "type": "array", "items": { "type": "string", "minLength": 1 }, "uniqueItems": true } }, "required": ["id", "kind", "label", "tags"], "additionalProperties": false };
function validate41(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.id === void 0 && (missing0 = "id") || data.kind === void 0 && (missing0 = "kind") || data.label === void 0 && (missing0 = "label") || data.tags === void 0 && (missing0 = "tags")) {
        validate41.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "id" || key0 === "kind" || key0 === "label" || key0 === "tags")) {
            validate41.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.id !== void 0) {
            let data0 = data.id;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate41.errors = [{ instancePath: instancePath + "/id", schemaPath: "#/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate41.errors = [{ instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.kind !== void 0) {
              let data1 = data.kind;
              const _errs4 = errors;
              if (!(data1 === "image" || data1 === "audio")) {
                validate41.errors = [{ instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema40.properties.kind.enum }, message: "must be equal to one of the allowed values" }];
                return false;
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.label !== void 0) {
                let data2 = data.label;
                const _errs5 = errors;
                if (errors === _errs5) {
                  if (typeof data2 === "string") {
                    if (func2(data2) < 1) {
                      validate41.errors = [{ instancePath: instancePath + "/label", schemaPath: "#/properties/label/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                      return false;
                    }
                  } else {
                    validate41.errors = [{ instancePath: instancePath + "/label", schemaPath: "#/properties/label/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                    return false;
                  }
                }
                var valid0 = _errs5 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.tags !== void 0) {
                  let data3 = data.tags;
                  const _errs7 = errors;
                  if (errors === _errs7) {
                    if (Array.isArray(data3)) {
                      var valid1 = true;
                      const len0 = data3.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        let data4 = data3[i0];
                        const _errs9 = errors;
                        if (errors === _errs9) {
                          if (typeof data4 === "string") {
                            if (func2(data4) < 1) {
                              validate41.errors = [{ instancePath: instancePath + "/tags/" + i0, schemaPath: "#/properties/tags/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                              return false;
                            }
                          } else {
                            validate41.errors = [{ instancePath: instancePath + "/tags/" + i0, schemaPath: "#/properties/tags/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                            return false;
                          }
                        }
                        var valid1 = _errs9 === errors;
                        if (!valid1) {
                          break;
                        }
                      }
                      if (valid1) {
                        let i1 = data3.length;
                        let j0;
                        if (i1 > 1) {
                          const indices0 = {};
                          for (; i1--; ) {
                            let item0 = data3[i1];
                            if (typeof item0 !== "string") {
                              continue;
                            }
                            if (typeof indices0[item0] == "number") {
                              j0 = indices0[item0];
                              validate41.errors = [{ instancePath: instancePath + "/tags", schemaPath: "#/properties/tags/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" }];
                              return false;
                              break;
                            }
                            indices0[item0] = i1;
                          }
                        }
                      }
                    } else {
                      validate41.errors = [{ instancePath: instancePath + "/tags", schemaPath: "#/properties/tags/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                      return false;
                    }
                  }
                  var valid0 = _errs7 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate41.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate41.errors = vErrors;
  return errors === 0;
}
var assetsListResult = validate42;
function validate42(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (Array.isArray(data)) {
      var valid0 = true;
      const len0 = data.length;
      for (let i0 = 0; i0 < len0; i0++) {
        let data0 = data[i0];
        const _errs1 = errors;
        const _errs2 = errors;
        if (errors === _errs2) {
          if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
            let missing0;
            if (data0.id === void 0 && (missing0 = "id") || data0.kind === void 0 && (missing0 = "kind") || data0.label === void 0 && (missing0 = "label") || data0.tags === void 0 && (missing0 = "tags")) {
              validate42.errors = [{ instancePath: instancePath + "/" + i0, schemaPath: "#/definitions/assetMetadata/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
              return false;
            } else {
              const _errs4 = errors;
              for (const key0 in data0) {
                if (!(key0 === "id" || key0 === "kind" || key0 === "label" || key0 === "tags")) {
                  validate42.errors = [{ instancePath: instancePath + "/" + i0, schemaPath: "#/definitions/assetMetadata/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                  return false;
                  break;
                }
              }
              if (_errs4 === errors) {
                if (data0.id !== void 0) {
                  let data1 = data0.id;
                  const _errs5 = errors;
                  if (errors === _errs5) {
                    if (typeof data1 === "string") {
                      if (func2(data1) < 1) {
                        validate42.errors = [{ instancePath: instancePath + "/" + i0 + "/id", schemaPath: "#/definitions/assetMetadata/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                        return false;
                      }
                    } else {
                      validate42.errors = [{ instancePath: instancePath + "/" + i0 + "/id", schemaPath: "#/definitions/assetMetadata/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                      return false;
                    }
                  }
                  var valid2 = _errs5 === errors;
                } else {
                  var valid2 = true;
                }
                if (valid2) {
                  if (data0.kind !== void 0) {
                    let data2 = data0.kind;
                    const _errs7 = errors;
                    if (!(data2 === "image" || data2 === "audio")) {
                      validate42.errors = [{ instancePath: instancePath + "/" + i0 + "/kind", schemaPath: "#/definitions/assetMetadata/properties/kind/enum", keyword: "enum", params: { allowedValues: schema40.properties.kind.enum }, message: "must be equal to one of the allowed values" }];
                      return false;
                    }
                    var valid2 = _errs7 === errors;
                  } else {
                    var valid2 = true;
                  }
                  if (valid2) {
                    if (data0.label !== void 0) {
                      let data3 = data0.label;
                      const _errs8 = errors;
                      if (errors === _errs8) {
                        if (typeof data3 === "string") {
                          if (func2(data3) < 1) {
                            validate42.errors = [{ instancePath: instancePath + "/" + i0 + "/label", schemaPath: "#/definitions/assetMetadata/properties/label/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                            return false;
                          }
                        } else {
                          validate42.errors = [{ instancePath: instancePath + "/" + i0 + "/label", schemaPath: "#/definitions/assetMetadata/properties/label/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                          return false;
                        }
                      }
                      var valid2 = _errs8 === errors;
                    } else {
                      var valid2 = true;
                    }
                    if (valid2) {
                      if (data0.tags !== void 0) {
                        let data4 = data0.tags;
                        const _errs10 = errors;
                        if (errors === _errs10) {
                          if (Array.isArray(data4)) {
                            var valid3 = true;
                            const len1 = data4.length;
                            for (let i1 = 0; i1 < len1; i1++) {
                              let data5 = data4[i1];
                              const _errs12 = errors;
                              if (errors === _errs12) {
                                if (typeof data5 === "string") {
                                  if (func2(data5) < 1) {
                                    validate42.errors = [{ instancePath: instancePath + "/" + i0 + "/tags/" + i1, schemaPath: "#/definitions/assetMetadata/properties/tags/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                    return false;
                                  }
                                } else {
                                  validate42.errors = [{ instancePath: instancePath + "/" + i0 + "/tags/" + i1, schemaPath: "#/definitions/assetMetadata/properties/tags/items/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                  return false;
                                }
                              }
                              var valid3 = _errs12 === errors;
                              if (!valid3) {
                                break;
                              }
                            }
                            if (valid3) {
                              let i2 = data4.length;
                              let j0;
                              if (i2 > 1) {
                                const indices0 = {};
                                for (; i2--; ) {
                                  let item0 = data4[i2];
                                  if (typeof item0 !== "string") {
                                    continue;
                                  }
                                  if (typeof indices0[item0] == "number") {
                                    j0 = indices0[item0];
                                    validate42.errors = [{ instancePath: instancePath + "/" + i0 + "/tags", schemaPath: "#/definitions/assetMetadata/properties/tags/uniqueItems", keyword: "uniqueItems", params: { i: i2, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i2 + " are identical)" }];
                                    return false;
                                    break;
                                  }
                                  indices0[item0] = i2;
                                }
                              }
                            }
                          } else {
                            validate42.errors = [{ instancePath: instancePath + "/" + i0 + "/tags", schemaPath: "#/definitions/assetMetadata/properties/tags/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
                            return false;
                          }
                        }
                        var valid2 = _errs10 === errors;
                      } else {
                        var valid2 = true;
                      }
                    }
                  }
                }
              }
            }
          } else {
            validate42.errors = [{ instancePath: instancePath + "/" + i0, schemaPath: "#/definitions/assetMetadata/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
            return false;
          }
        }
        var valid0 = _errs1 === errors;
        if (!valid0) {
          break;
        }
      }
    } else {
      validate42.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
      return false;
    }
  }
  validate42.errors = vErrors;
  return errors === 0;
}
var mediaPlayParams = validate43;
function validate43(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.asset === void 0 && (missing0 = "asset") || data.channel === void 0 && (missing0 = "channel")) {
        validate43.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "asset" || key0 === "channel" || key0 === "loop" || key0 === "volume")) {
            validate43.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.asset !== void 0) {
            let data0 = data.asset;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate43.errors = [{ instancePath: instancePath + "/asset", schemaPath: "#/properties/asset/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate43.errors = [{ instancePath: instancePath + "/asset", schemaPath: "#/properties/asset/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.channel !== void 0) {
              let data1 = data.channel;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (typeof data1 === "string") {
                  if (func2(data1) < 1) {
                    validate43.errors = [{ instancePath: instancePath + "/channel", schemaPath: "#/properties/channel/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                } else {
                  validate43.errors = [{ instancePath: instancePath + "/channel", schemaPath: "#/properties/channel/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.loop !== void 0) {
                const _errs6 = errors;
                if (typeof data.loop !== "boolean") {
                  validate43.errors = [{ instancePath: instancePath + "/loop", schemaPath: "#/properties/loop/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" }];
                  return false;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.volume !== void 0) {
                  let data3 = data.volume;
                  const _errs8 = errors;
                  if (errors === _errs8) {
                    if (typeof data3 == "number" && isFinite(data3)) {
                      if (data3 > 1 || isNaN(data3)) {
                        validate43.errors = [{ instancePath: instancePath + "/volume", schemaPath: "#/properties/volume/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1 }, message: "must be <= 1" }];
                        return false;
                      } else {
                        if (data3 < 0 || isNaN(data3)) {
                          validate43.errors = [{ instancePath: instancePath + "/volume", schemaPath: "#/properties/volume/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                          return false;
                        }
                      }
                    } else {
                      validate43.errors = [{ instancePath: instancePath + "/volume", schemaPath: "#/properties/volume/type", keyword: "type", params: { type: "number" }, message: "must be number" }];
                      return false;
                    }
                  }
                  var valid0 = _errs8 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate43.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate43.errors = vErrors;
  return errors === 0;
}
var mediaPlayResult = validate44;
function validate44(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (data !== null) {
    validate44.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "null" }, message: "must be null" }];
    return false;
  }
  validate44.errors = vErrors;
  return errors === 0;
}
var timerAfterDelay = validate45;
function validate45(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (!(typeof data == "number" && (!(data % 1) && !isNaN(data)) && isFinite(data))) {
    validate45.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "integer" }, message: "must be integer" }];
    return false;
  }
  if (errors === 0) {
    if (typeof data == "number" && isFinite(data)) {
      if (data < 0 || isNaN(data)) {
        validate45.errors = [{ instancePath, schemaPath: "#/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
        return false;
      }
    }
  }
  validate45.errors = vErrors;
  return errors === 0;
}
var timerEveryDelay = validate46;
function validate46(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (!(typeof data == "number" && (!(data % 1) && !isNaN(data)) && isFinite(data))) {
    validate46.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "integer" }, message: "must be integer" }];
    return false;
  }
  if (errors === 0) {
    if (typeof data == "number" && isFinite(data)) {
      if (data < 1 || isNaN(data)) {
        validate46.errors = [{ instancePath, schemaPath: "#/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" }];
        return false;
      }
    }
  }
  validate46.errors = vErrors;
  return errors === 0;
}
var snapshotSource = validate47;
function validate47(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (errors === _errs1) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.kind === void 0 && (missing0 = "kind") || data.runId === void 0 && (missing0 = "runId") || data.jobId === void 0 && (missing0 = "jobId")) {
        const err0 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      } else {
        const _errs3 = errors;
        for (const key0 in data) {
          if (!(key0 === "kind" || key0 === "runId" || key0 === "jobId")) {
            const err1 = { instancePath, schemaPath: "#/oneOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err1];
            } else {
              vErrors.push(err1);
            }
            errors++;
            break;
          }
        }
        if (_errs3 === errors) {
          if (data.kind !== void 0) {
            const _errs4 = errors;
            if ("initial" !== data.kind) {
              const err2 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/0/properties/kind/const", keyword: "const", params: { allowedValue: "initial" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err2];
              } else {
                vErrors.push(err2);
              }
              errors++;
            }
            var valid1 = _errs4 === errors;
          } else {
            var valid1 = true;
          }
          if (valid1) {
            if (data.runId !== void 0) {
              const _errs5 = errors;
              if (data.runId !== null) {
                const err3 = { instancePath: instancePath + "/runId", schemaPath: "#/oneOf/0/properties/runId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                if (vErrors === null) {
                  vErrors = [err3];
                } else {
                  vErrors.push(err3);
                }
                errors++;
              }
              var valid1 = _errs5 === errors;
            } else {
              var valid1 = true;
            }
            if (valid1) {
              if (data.jobId !== void 0) {
                const _errs7 = errors;
                if (data.jobId !== null) {
                  const err4 = { instancePath: instancePath + "/jobId", schemaPath: "#/oneOf/0/properties/jobId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                  if (vErrors === null) {
                    vErrors = [err4];
                  } else {
                    vErrors.push(err4);
                  }
                  errors++;
                }
                var valid1 = _errs7 === errors;
              } else {
                var valid1 = true;
              }
            }
          }
        }
      }
    } else {
      const err5 = { instancePath, schemaPath: "#/oneOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
  }
  const _errs9 = errors;
  if (errors === _errs9) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing1;
      if (data.kind === void 0 && (missing1 = "kind") || data.runId === void 0 && (missing1 = "runId") || data.jobId === void 0 && (missing1 = "jobId")) {
        const err6 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: missing1 }, message: "must have required property '" + missing1 + "'" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      } else {
        const _errs11 = errors;
        for (const key1 in data) {
          if (!(key1 === "kind" || key1 === "runId" || key1 === "jobId")) {
            const err7 = { instancePath, schemaPath: "#/oneOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
            break;
          }
        }
        if (_errs11 === errors) {
          if (data.kind !== void 0) {
            const _errs12 = errors;
            if ("floor" !== data.kind) {
              const err8 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/1/properties/kind/const", keyword: "const", params: { allowedValue: "floor" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
            var valid2 = _errs12 === errors;
          } else {
            var valid2 = true;
          }
          if (valid2) {
            if (data.runId !== void 0) {
              let data4 = data.runId;
              const _errs13 = errors;
              if (errors === _errs13) {
                if (typeof data4 === "string") {
                  if (func2(data4) < 1) {
                    const err9 = { instancePath: instancePath + "/runId", schemaPath: "#/oneOf/1/properties/runId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                    if (vErrors === null) {
                      vErrors = [err9];
                    } else {
                      vErrors.push(err9);
                    }
                    errors++;
                  }
                } else {
                  const err10 = { instancePath: instancePath + "/runId", schemaPath: "#/oneOf/1/properties/runId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err10];
                  } else {
                    vErrors.push(err10);
                  }
                  errors++;
                }
              }
              var valid2 = _errs13 === errors;
            } else {
              var valid2 = true;
            }
            if (valid2) {
              if (data.jobId !== void 0) {
                const _errs15 = errors;
                if (data.jobId !== null) {
                  const err11 = { instancePath: instancePath + "/jobId", schemaPath: "#/oneOf/1/properties/jobId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                  if (vErrors === null) {
                    vErrors = [err11];
                  } else {
                    vErrors.push(err11);
                  }
                  errors++;
                }
                var valid2 = _errs15 === errors;
              } else {
                var valid2 = true;
              }
            }
          }
        }
      }
    } else {
      const err12 = { instancePath, schemaPath: "#/oneOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
      if (vErrors === null) {
        vErrors = [err12];
      } else {
        vErrors.push(err12);
      }
      errors++;
    }
  }
  var _valid0 = _errs9 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
    }
    const _errs17 = errors;
    if (errors === _errs17) {
      if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing2;
        if (data.kind === void 0 && (missing2 = "kind") || data.runId === void 0 && (missing2 = "runId") || data.jobId === void 0 && (missing2 = "jobId")) {
          const err13 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: missing2 }, message: "must have required property '" + missing2 + "'" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        } else {
          const _errs19 = errors;
          for (const key2 in data) {
            if (!(key2 === "kind" || key2 === "runId" || key2 === "jobId")) {
              const err14 = { instancePath, schemaPath: "#/oneOf/2/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
              if (vErrors === null) {
                vErrors = [err14];
              } else {
                vErrors.push(err14);
              }
              errors++;
              break;
            }
          }
          if (_errs19 === errors) {
            if (data.kind !== void 0) {
              const _errs20 = errors;
              if ("job" !== data.kind) {
                const err15 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/2/properties/kind/const", keyword: "const", params: { allowedValue: "job" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err15];
                } else {
                  vErrors.push(err15);
                }
                errors++;
              }
              var valid3 = _errs20 === errors;
            } else {
              var valid3 = true;
            }
            if (valid3) {
              if (data.runId !== void 0) {
                let data7 = data.runId;
                const _errs21 = errors;
                if (typeof data7 !== "string" && data7 !== null) {
                  const err16 = { instancePath: instancePath + "/runId", schemaPath: "#/oneOf/2/properties/runId/type", keyword: "type", params: { type: schema15.oneOf[2].properties.runId.type }, message: "must be string,null" };
                  if (vErrors === null) {
                    vErrors = [err16];
                  } else {
                    vErrors.push(err16);
                  }
                  errors++;
                }
                if (errors === _errs21) {
                  if (typeof data7 === "string") {
                    if (func2(data7) < 1) {
                      const err17 = { instancePath: instancePath + "/runId", schemaPath: "#/oneOf/2/properties/runId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                      if (vErrors === null) {
                        vErrors = [err17];
                      } else {
                        vErrors.push(err17);
                      }
                      errors++;
                    }
                  }
                }
                var valid3 = _errs21 === errors;
              } else {
                var valid3 = true;
              }
              if (valid3) {
                if (data.jobId !== void 0) {
                  let data8 = data.jobId;
                  const _errs23 = errors;
                  if (errors === _errs23) {
                    if (typeof data8 === "string") {
                      if (func2(data8) < 1) {
                        const err18 = { instancePath: instancePath + "/jobId", schemaPath: "#/oneOf/2/properties/jobId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                        if (vErrors === null) {
                          vErrors = [err18];
                        } else {
                          vErrors.push(err18);
                        }
                        errors++;
                      }
                    } else {
                      const err19 = { instancePath: instancePath + "/jobId", schemaPath: "#/oneOf/2/properties/jobId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                      if (vErrors === null) {
                        vErrors = [err19];
                      } else {
                        vErrors.push(err19);
                      }
                      errors++;
                    }
                  }
                  var valid3 = _errs23 === errors;
                } else {
                  var valid3 = true;
                }
              }
            }
          }
        }
      } else {
        const err20 = { instancePath, schemaPath: "#/oneOf/2/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
    }
    var _valid0 = _errs17 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
      }
      const _errs25 = errors;
      if (errors === _errs25) {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          let missing3;
          if (data.kind === void 0 && (missing3 = "kind") || data.runId === void 0 && (missing3 = "runId") || data.jobId === void 0 && (missing3 = "jobId")) {
            const err21 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: missing3 }, message: "must have required property '" + missing3 + "'" };
            if (vErrors === null) {
              vErrors = [err21];
            } else {
              vErrors.push(err21);
            }
            errors++;
          } else {
            const _errs27 = errors;
            for (const key3 in data) {
              if (!(key3 === "kind" || key3 === "runId" || key3 === "jobId")) {
                const err22 = { instancePath, schemaPath: "#/oneOf/3/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err22];
                } else {
                  vErrors.push(err22);
                }
                errors++;
                break;
              }
            }
            if (_errs27 === errors) {
              if (data.kind !== void 0) {
                const _errs28 = errors;
                if ("manual" !== data.kind) {
                  const err23 = { instancePath: instancePath + "/kind", schemaPath: "#/oneOf/3/properties/kind/const", keyword: "const", params: { allowedValue: "manual" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err23];
                  } else {
                    vErrors.push(err23);
                  }
                  errors++;
                }
                var valid4 = _errs28 === errors;
              } else {
                var valid4 = true;
              }
              if (valid4) {
                if (data.runId !== void 0) {
                  const _errs29 = errors;
                  if (data.runId !== null) {
                    const err24 = { instancePath: instancePath + "/runId", schemaPath: "#/oneOf/3/properties/runId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                    if (vErrors === null) {
                      vErrors = [err24];
                    } else {
                      vErrors.push(err24);
                    }
                    errors++;
                  }
                  var valid4 = _errs29 === errors;
                } else {
                  var valid4 = true;
                }
                if (valid4) {
                  if (data.jobId !== void 0) {
                    const _errs31 = errors;
                    if (data.jobId !== null) {
                      const err25 = { instancePath: instancePath + "/jobId", schemaPath: "#/oneOf/3/properties/jobId/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                      if (vErrors === null) {
                        vErrors = [err25];
                      } else {
                        vErrors.push(err25);
                      }
                      errors++;
                    }
                    var valid4 = _errs31 === errors;
                  } else {
                    var valid4 = true;
                  }
                }
              }
            }
          }
        } else {
          const err26 = { instancePath, schemaPath: "#/oneOf/3/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err26];
          } else {
            vErrors.push(err26);
          }
          errors++;
        }
      }
      var _valid0 = _errs25 === errors;
      if (_valid0 && valid0) {
        valid0 = false;
        passing0 = [passing0, 3];
      } else {
        if (_valid0) {
          valid0 = true;
          passing0 = 3;
        }
      }
    }
  }
  if (!valid0) {
    const err27 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err27];
    } else {
      vErrors.push(err27);
    }
    errors++;
    validate47.errors = vErrors;
    return false;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate47.errors = vErrors;
  return errors === 0;
}
var textStreamFilter = validate48;
function validate48(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      const _errs1 = errors;
      for (const key0 in data) {
        if (!(key0 === "floorId" || key0 === "streamId")) {
          validate48.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
          return false;
          break;
        }
      }
      if (_errs1 === errors) {
        if (data.floorId !== void 0) {
          let data0 = data.floorId;
          const _errs2 = errors;
          if (errors === _errs2) {
            if (typeof data0 === "string") {
              if (func2(data0) < 1) {
                validate48.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                return false;
              }
            } else {
              validate48.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
              return false;
            }
          }
          var valid0 = _errs2 === errors;
        } else {
          var valid0 = true;
        }
        if (valid0) {
          if (data.streamId !== void 0) {
            let data1 = data.streamId;
            const _errs4 = errors;
            if (errors === _errs4) {
              if (typeof data1 === "string") {
                if (func2(data1) < 1) {
                  validate48.errors = [{ instancePath: instancePath + "/streamId", schemaPath: "#/properties/streamId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate48.errors = [{ instancePath: instancePath + "/streamId", schemaPath: "#/properties/streamId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid0 = _errs4 === errors;
          } else {
            var valid0 = true;
          }
        }
      }
    } else {
      validate48.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate48.errors = vErrors;
  return errors === 0;
}
var textStreamEvent = validate49;
var schema49 = { "type": "object", "properties": { "sessionId": { "type": "string", "minLength": 1 }, "branchId": { "type": "string", "minLength": 1 }, "floorId": { "type": "string", "minLength": 1 }, "attemptId": { "type": "string", "minLength": 1 }, "streamId": { "type": "string", "minLength": 1 }, "runId": { "type": ["string", "null"], "minLength": 1 }, "jobId": { "type": ["string", "null"], "minLength": 1 }, "messageId": { "type": ["string", "null"], "minLength": 1 }, "revision": { "type": "integer", "minimum": 0 }, "type": { "enum": ["snapshot", "start", "update", "end", "error", "cancelled"] }, "status": { "enum": ["streaming", "completed", "failed", "cancelled"] }, "text": { "type": "string" }, "error": { "anyOf": [{ "type": "null" }, { "$ref": "#/definitions/error" }] } }, "required": ["sessionId", "branchId", "floorId", "attemptId", "streamId", "runId", "jobId", "messageId", "revision", "type", "status", "text", "error"], "additionalProperties": false, "allOf": [{ "anyOf": [{ "properties": { "runId": { "type": "string", "minLength": 1 } } }, { "properties": { "jobId": { "type": "string", "minLength": 1 } } }] }, { "oneOf": [{ "properties": { "type": { "const": "snapshot" } } }, { "properties": { "type": { "enum": ["start", "update"] }, "status": { "const": "streaming" } } }, { "properties": { "type": { "const": "end" }, "status": { "const": "completed" } } }, { "properties": { "type": { "const": "error" }, "status": { "const": "failed" } } }, { "properties": { "type": { "const": "cancelled" }, "status": { "const": "cancelled" } } }] }, { "if": { "properties": { "status": { "const": "failed" } } }, "then": { "properties": { "error": { "$ref": "#/definitions/error" } } }, "else": { "properties": { "error": { "type": "null" } } } }] };
function validate49(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  const _errs1 = errors;
  const _errs2 = errors;
  let valid1 = false;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.runId !== void 0) {
      let data0 = data.runId;
      const _errs4 = errors;
      if (errors === _errs4) {
        if (typeof data0 === "string") {
          if (func2(data0) < 1) {
            const err0 = { instancePath: instancePath + "/runId", schemaPath: "#/allOf/0/anyOf/0/properties/runId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
            if (vErrors === null) {
              vErrors = [err0];
            } else {
              vErrors.push(err0);
            }
            errors++;
          }
        } else {
          const err1 = { instancePath: instancePath + "/runId", schemaPath: "#/allOf/0/anyOf/0/properties/runId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      }
    }
  }
  var _valid0 = _errs3 === errors;
  valid1 = valid1 || _valid0;
  if (!valid1) {
    const _errs6 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.jobId !== void 0) {
        let data1 = data.jobId;
        const _errs7 = errors;
        if (errors === _errs7) {
          if (typeof data1 === "string") {
            if (func2(data1) < 1) {
              const err2 = { instancePath: instancePath + "/jobId", schemaPath: "#/allOf/0/anyOf/1/properties/jobId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err2];
              } else {
                vErrors.push(err2);
              }
              errors++;
            }
          } else {
            const err3 = { instancePath: instancePath + "/jobId", schemaPath: "#/allOf/0/anyOf/1/properties/jobId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        }
      }
    }
    var _valid0 = _errs6 === errors;
    valid1 = valid1 || _valid0;
  }
  if (!valid1) {
    const err4 = { instancePath, schemaPath: "#/allOf/0/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
    if (vErrors === null) {
      vErrors = [err4];
    } else {
      vErrors.push(err4);
    }
    errors++;
    validate49.errors = vErrors;
    return false;
  } else {
    errors = _errs2;
    if (vErrors !== null) {
      if (_errs2) {
        vErrors.length = _errs2;
      } else {
        vErrors = null;
      }
    }
  }
  var valid0 = _errs1 === errors;
  if (valid0) {
    const _errs9 = errors;
    const _errs10 = errors;
    let valid4 = false;
    let passing0 = null;
    const _errs11 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.type !== void 0) {
        if ("snapshot" !== data.type) {
          const err5 = { instancePath: instancePath + "/type", schemaPath: "#/allOf/1/oneOf/0/properties/type/const", keyword: "const", params: { allowedValue: "snapshot" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      }
    }
    var _valid1 = _errs11 === errors;
    if (_valid1) {
      valid4 = true;
      passing0 = 0;
    }
    const _errs13 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.type !== void 0) {
        let data3 = data.type;
        const _errs14 = errors;
        if (!(data3 === "start" || data3 === "update")) {
          const err6 = { instancePath: instancePath + "/type", schemaPath: "#/allOf/1/oneOf/1/properties/type/enum", keyword: "enum", params: { allowedValues: schema49.allOf[1].oneOf[1].properties.type.enum }, message: "must be equal to one of the allowed values" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        var valid6 = _errs14 === errors;
      } else {
        var valid6 = true;
      }
      if (valid6) {
        if (data.status !== void 0) {
          const _errs15 = errors;
          if ("streaming" !== data.status) {
            const err7 = { instancePath: instancePath + "/status", schemaPath: "#/allOf/1/oneOf/1/properties/status/const", keyword: "const", params: { allowedValue: "streaming" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
          }
          var valid6 = _errs15 === errors;
        } else {
          var valid6 = true;
        }
      }
    }
    var _valid1 = _errs13 === errors;
    if (_valid1 && valid4) {
      valid4 = false;
      passing0 = [passing0, 1];
    } else {
      if (_valid1) {
        valid4 = true;
        passing0 = 1;
      }
      const _errs16 = errors;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.type !== void 0) {
          const _errs17 = errors;
          if ("end" !== data.type) {
            const err8 = { instancePath: instancePath + "/type", schemaPath: "#/allOf/1/oneOf/2/properties/type/const", keyword: "const", params: { allowedValue: "end" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
          var valid7 = _errs17 === errors;
        } else {
          var valid7 = true;
        }
        if (valid7) {
          if (data.status !== void 0) {
            const _errs18 = errors;
            if ("completed" !== data.status) {
              const err9 = { instancePath: instancePath + "/status", schemaPath: "#/allOf/1/oneOf/2/properties/status/const", keyword: "const", params: { allowedValue: "completed" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err9];
              } else {
                vErrors.push(err9);
              }
              errors++;
            }
            var valid7 = _errs18 === errors;
          } else {
            var valid7 = true;
          }
        }
      }
      var _valid1 = _errs16 === errors;
      if (_valid1 && valid4) {
        valid4 = false;
        passing0 = [passing0, 2];
      } else {
        if (_valid1) {
          valid4 = true;
          passing0 = 2;
        }
        const _errs19 = errors;
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.type !== void 0) {
            const _errs20 = errors;
            if ("error" !== data.type) {
              const err10 = { instancePath: instancePath + "/type", schemaPath: "#/allOf/1/oneOf/3/properties/type/const", keyword: "const", params: { allowedValue: "error" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
            var valid8 = _errs20 === errors;
          } else {
            var valid8 = true;
          }
          if (valid8) {
            if (data.status !== void 0) {
              const _errs21 = errors;
              if ("failed" !== data.status) {
                const err11 = { instancePath: instancePath + "/status", schemaPath: "#/allOf/1/oneOf/3/properties/status/const", keyword: "const", params: { allowedValue: "failed" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err11];
                } else {
                  vErrors.push(err11);
                }
                errors++;
              }
              var valid8 = _errs21 === errors;
            } else {
              var valid8 = true;
            }
          }
        }
        var _valid1 = _errs19 === errors;
        if (_valid1 && valid4) {
          valid4 = false;
          passing0 = [passing0, 3];
        } else {
          if (_valid1) {
            valid4 = true;
            passing0 = 3;
          }
          const _errs22 = errors;
          if (data && typeof data == "object" && !Array.isArray(data)) {
            if (data.type !== void 0) {
              const _errs23 = errors;
              if ("cancelled" !== data.type) {
                const err12 = { instancePath: instancePath + "/type", schemaPath: "#/allOf/1/oneOf/4/properties/type/const", keyword: "const", params: { allowedValue: "cancelled" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err12];
                } else {
                  vErrors.push(err12);
                }
                errors++;
              }
              var valid9 = _errs23 === errors;
            } else {
              var valid9 = true;
            }
            if (valid9) {
              if (data.status !== void 0) {
                const _errs24 = errors;
                if ("cancelled" !== data.status) {
                  const err13 = { instancePath: instancePath + "/status", schemaPath: "#/allOf/1/oneOf/4/properties/status/const", keyword: "const", params: { allowedValue: "cancelled" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err13];
                  } else {
                    vErrors.push(err13);
                  }
                  errors++;
                }
                var valid9 = _errs24 === errors;
              } else {
                var valid9 = true;
              }
            }
          }
          var _valid1 = _errs22 === errors;
          if (_valid1 && valid4) {
            valid4 = false;
            passing0 = [passing0, 4];
          } else {
            if (_valid1) {
              valid4 = true;
              passing0 = 4;
            }
          }
        }
      }
    }
    if (!valid4) {
      const err14 = { instancePath, schemaPath: "#/allOf/1/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
      if (vErrors === null) {
        vErrors = [err14];
      } else {
        vErrors.push(err14);
      }
      errors++;
      validate49.errors = vErrors;
      return false;
    } else {
      errors = _errs10;
      if (vErrors !== null) {
        if (_errs10) {
          vErrors.length = _errs10;
        } else {
          vErrors = null;
        }
      }
    }
    var valid0 = _errs9 === errors;
    if (valid0) {
      const _errs25 = errors;
      const _errs26 = errors;
      let valid10 = true;
      const _errs27 = errors;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.status !== void 0) {
          if ("failed" !== data.status) {
            const err15 = {};
            if (vErrors === null) {
              vErrors = [err15];
            } else {
              vErrors.push(err15);
            }
            errors++;
          }
        }
      }
      var _valid2 = _errs27 === errors;
      errors = _errs26;
      if (vErrors !== null) {
        if (_errs26) {
          vErrors.length = _errs26;
        } else {
          vErrors = null;
        }
      }
      let ifClause0;
      if (_valid2) {
        const _errs29 = errors;
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.error !== void 0) {
            let data12 = data.error;
            const _errs31 = errors;
            if (errors === _errs31) {
              if (data12 && typeof data12 == "object" && !Array.isArray(data12)) {
                let missing0;
                if (data12.code === void 0 && (missing0 = "code") || data12.message === void 0 && (missing0 = "message")) {
                  validate49.errors = [{ instancePath: instancePath + "/error", schemaPath: "#/definitions/error/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
                  return false;
                } else {
                  const _errs33 = errors;
                  for (const key0 in data12) {
                    if (!(key0 === "code" || key0 === "message")) {
                      validate49.errors = [{ instancePath: instancePath + "/error", schemaPath: "#/definitions/error/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                      return false;
                      break;
                    }
                  }
                  if (_errs33 === errors) {
                    if (data12.code !== void 0) {
                      let data13 = data12.code;
                      const _errs34 = errors;
                      if (errors === _errs34) {
                        if (typeof data13 === "string") {
                          if (func2(data13) < 1) {
                            validate49.errors = [{ instancePath: instancePath + "/error/code", schemaPath: "#/definitions/error/properties/code/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                            return false;
                          }
                        } else {
                          validate49.errors = [{ instancePath: instancePath + "/error/code", schemaPath: "#/definitions/error/properties/code/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                          return false;
                        }
                      }
                      var valid14 = _errs34 === errors;
                    } else {
                      var valid14 = true;
                    }
                    if (valid14) {
                      if (data12.message !== void 0) {
                        let data14 = data12.message;
                        const _errs36 = errors;
                        if (errors === _errs36) {
                          if (typeof data14 === "string") {
                            if (func2(data14) < 1) {
                              validate49.errors = [{ instancePath: instancePath + "/error/message", schemaPath: "#/definitions/error/properties/message/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                              return false;
                            }
                          } else {
                            validate49.errors = [{ instancePath: instancePath + "/error/message", schemaPath: "#/definitions/error/properties/message/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                            return false;
                          }
                        }
                        var valid14 = _errs36 === errors;
                      } else {
                        var valid14 = true;
                      }
                    }
                  }
                }
              } else {
                validate49.errors = [{ instancePath: instancePath + "/error", schemaPath: "#/definitions/error/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                return false;
              }
            }
          }
        }
        var _valid2 = _errs29 === errors;
        valid10 = _valid2;
        ifClause0 = "then";
      } else {
        const _errs38 = errors;
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.error !== void 0) {
            if (data.error !== null) {
              validate49.errors = [{ instancePath: instancePath + "/error", schemaPath: "#/allOf/2/else/properties/error/type", keyword: "type", params: { type: "null" }, message: "must be null" }];
              return false;
            }
          }
        }
        var _valid2 = _errs38 === errors;
        valid10 = _valid2;
        ifClause0 = "else";
      }
      if (!valid10) {
        const err16 = { instancePath, schemaPath: "#/allOf/2/if", keyword: "if", params: { failingKeyword: ifClause0 }, message: 'must match "' + ifClause0 + '" schema' };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
        validate49.errors = vErrors;
        return false;
      }
      var valid0 = _errs25 === errors;
    }
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing1;
      if (data.sessionId === void 0 && (missing1 = "sessionId") || data.branchId === void 0 && (missing1 = "branchId") || data.floorId === void 0 && (missing1 = "floorId") || data.attemptId === void 0 && (missing1 = "attemptId") || data.streamId === void 0 && (missing1 = "streamId") || data.runId === void 0 && (missing1 = "runId") || data.jobId === void 0 && (missing1 = "jobId") || data.messageId === void 0 && (missing1 = "messageId") || data.revision === void 0 && (missing1 = "revision") || data.type === void 0 && (missing1 = "type") || data.status === void 0 && (missing1 = "status") || data.text === void 0 && (missing1 = "text") || data.error === void 0 && (missing1 = "error")) {
        validate49.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing1 }, message: "must have required property '" + missing1 + "'" }];
        return false;
      } else {
        const _errs41 = errors;
        for (const key1 in data) {
          if (!func24.call(schema49.properties, key1)) {
            validate49.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs41 === errors) {
          if (data.sessionId !== void 0) {
            let data16 = data.sessionId;
            const _errs42 = errors;
            if (errors === _errs42) {
              if (typeof data16 === "string") {
                if (func2(data16) < 1) {
                  validate49.errors = [{ instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate49.errors = [{ instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid16 = _errs42 === errors;
          } else {
            var valid16 = true;
          }
          if (valid16) {
            if (data.branchId !== void 0) {
              let data17 = data.branchId;
              const _errs44 = errors;
              if (errors === _errs44) {
                if (typeof data17 === "string") {
                  if (func2(data17) < 1) {
                    validate49.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                } else {
                  validate49.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
              }
              var valid16 = _errs44 === errors;
            } else {
              var valid16 = true;
            }
            if (valid16) {
              if (data.floorId !== void 0) {
                let data18 = data.floorId;
                const _errs46 = errors;
                if (errors === _errs46) {
                  if (typeof data18 === "string") {
                    if (func2(data18) < 1) {
                      validate49.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                      return false;
                    }
                  } else {
                    validate49.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                    return false;
                  }
                }
                var valid16 = _errs46 === errors;
              } else {
                var valid16 = true;
              }
              if (valid16) {
                if (data.attemptId !== void 0) {
                  let data19 = data.attemptId;
                  const _errs48 = errors;
                  if (errors === _errs48) {
                    if (typeof data19 === "string") {
                      if (func2(data19) < 1) {
                        validate49.errors = [{ instancePath: instancePath + "/attemptId", schemaPath: "#/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                        return false;
                      }
                    } else {
                      validate49.errors = [{ instancePath: instancePath + "/attemptId", schemaPath: "#/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                      return false;
                    }
                  }
                  var valid16 = _errs48 === errors;
                } else {
                  var valid16 = true;
                }
                if (valid16) {
                  if (data.streamId !== void 0) {
                    let data20 = data.streamId;
                    const _errs50 = errors;
                    if (errors === _errs50) {
                      if (typeof data20 === "string") {
                        if (func2(data20) < 1) {
                          validate49.errors = [{ instancePath: instancePath + "/streamId", schemaPath: "#/properties/streamId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                          return false;
                        }
                      } else {
                        validate49.errors = [{ instancePath: instancePath + "/streamId", schemaPath: "#/properties/streamId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                        return false;
                      }
                    }
                    var valid16 = _errs50 === errors;
                  } else {
                    var valid16 = true;
                  }
                  if (valid16) {
                    if (data.runId !== void 0) {
                      let data21 = data.runId;
                      const _errs52 = errors;
                      if (typeof data21 !== "string" && data21 !== null) {
                        validate49.errors = [{ instancePath: instancePath + "/runId", schemaPath: "#/properties/runId/type", keyword: "type", params: { type: schema49.properties.runId.type }, message: "must be string,null" }];
                        return false;
                      }
                      if (errors === _errs52) {
                        if (typeof data21 === "string") {
                          if (func2(data21) < 1) {
                            validate49.errors = [{ instancePath: instancePath + "/runId", schemaPath: "#/properties/runId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                            return false;
                          }
                        }
                      }
                      var valid16 = _errs52 === errors;
                    } else {
                      var valid16 = true;
                    }
                    if (valid16) {
                      if (data.jobId !== void 0) {
                        let data22 = data.jobId;
                        const _errs54 = errors;
                        if (typeof data22 !== "string" && data22 !== null) {
                          validate49.errors = [{ instancePath: instancePath + "/jobId", schemaPath: "#/properties/jobId/type", keyword: "type", params: { type: schema49.properties.jobId.type }, message: "must be string,null" }];
                          return false;
                        }
                        if (errors === _errs54) {
                          if (typeof data22 === "string") {
                            if (func2(data22) < 1) {
                              validate49.errors = [{ instancePath: instancePath + "/jobId", schemaPath: "#/properties/jobId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                              return false;
                            }
                          }
                        }
                        var valid16 = _errs54 === errors;
                      } else {
                        var valid16 = true;
                      }
                      if (valid16) {
                        if (data.messageId !== void 0) {
                          let data23 = data.messageId;
                          const _errs56 = errors;
                          if (typeof data23 !== "string" && data23 !== null) {
                            validate49.errors = [{ instancePath: instancePath + "/messageId", schemaPath: "#/properties/messageId/type", keyword: "type", params: { type: schema49.properties.messageId.type }, message: "must be string,null" }];
                            return false;
                          }
                          if (errors === _errs56) {
                            if (typeof data23 === "string") {
                              if (func2(data23) < 1) {
                                validate49.errors = [{ instancePath: instancePath + "/messageId", schemaPath: "#/properties/messageId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                return false;
                              }
                            }
                          }
                          var valid16 = _errs56 === errors;
                        } else {
                          var valid16 = true;
                        }
                        if (valid16) {
                          if (data.revision !== void 0) {
                            let data24 = data.revision;
                            const _errs58 = errors;
                            if (!(typeof data24 == "number" && (!(data24 % 1) && !isNaN(data24)) && isFinite(data24))) {
                              validate49.errors = [{ instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" }];
                              return false;
                            }
                            if (errors === _errs58) {
                              if (typeof data24 == "number" && isFinite(data24)) {
                                if (data24 < 0 || isNaN(data24)) {
                                  validate49.errors = [{ instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                                  return false;
                                }
                              }
                            }
                            var valid16 = _errs58 === errors;
                          } else {
                            var valid16 = true;
                          }
                          if (valid16) {
                            if (data.type !== void 0) {
                              let data25 = data.type;
                              const _errs60 = errors;
                              if (!(data25 === "snapshot" || data25 === "start" || data25 === "update" || data25 === "end" || data25 === "error" || data25 === "cancelled")) {
                                validate49.errors = [{ instancePath: instancePath + "/type", schemaPath: "#/properties/type/enum", keyword: "enum", params: { allowedValues: schema49.properties.type.enum }, message: "must be equal to one of the allowed values" }];
                                return false;
                              }
                              var valid16 = _errs60 === errors;
                            } else {
                              var valid16 = true;
                            }
                            if (valid16) {
                              if (data.status !== void 0) {
                                let data26 = data.status;
                                const _errs61 = errors;
                                if (!(data26 === "streaming" || data26 === "completed" || data26 === "failed" || data26 === "cancelled")) {
                                  validate49.errors = [{ instancePath: instancePath + "/status", schemaPath: "#/properties/status/enum", keyword: "enum", params: { allowedValues: schema49.properties.status.enum }, message: "must be equal to one of the allowed values" }];
                                  return false;
                                }
                                var valid16 = _errs61 === errors;
                              } else {
                                var valid16 = true;
                              }
                              if (valid16) {
                                if (data.text !== void 0) {
                                  const _errs62 = errors;
                                  if (typeof data.text !== "string") {
                                    validate49.errors = [{ instancePath: instancePath + "/text", schemaPath: "#/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                    return false;
                                  }
                                  var valid16 = _errs62 === errors;
                                } else {
                                  var valid16 = true;
                                }
                                if (valid16) {
                                  if (data.error !== void 0) {
                                    let data28 = data.error;
                                    const _errs64 = errors;
                                    const _errs65 = errors;
                                    let valid17 = false;
                                    const _errs66 = errors;
                                    if (data28 !== null) {
                                      const err17 = { instancePath: instancePath + "/error", schemaPath: "#/properties/error/anyOf/0/type", keyword: "type", params: { type: "null" }, message: "must be null" };
                                      if (vErrors === null) {
                                        vErrors = [err17];
                                      } else {
                                        vErrors.push(err17);
                                      }
                                      errors++;
                                    }
                                    var _valid3 = _errs66 === errors;
                                    valid17 = valid17 || _valid3;
                                    if (!valid17) {
                                      const _errs68 = errors;
                                      const _errs69 = errors;
                                      if (errors === _errs69) {
                                        if (data28 && typeof data28 == "object" && !Array.isArray(data28)) {
                                          let missing2;
                                          if (data28.code === void 0 && (missing2 = "code") || data28.message === void 0 && (missing2 = "message")) {
                                            const err18 = { instancePath: instancePath + "/error", schemaPath: "#/definitions/error/required", keyword: "required", params: { missingProperty: missing2 }, message: "must have required property '" + missing2 + "'" };
                                            if (vErrors === null) {
                                              vErrors = [err18];
                                            } else {
                                              vErrors.push(err18);
                                            }
                                            errors++;
                                          } else {
                                            const _errs71 = errors;
                                            for (const key2 in data28) {
                                              if (!(key2 === "code" || key2 === "message")) {
                                                const err19 = { instancePath: instancePath + "/error", schemaPath: "#/definitions/error/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                                                if (vErrors === null) {
                                                  vErrors = [err19];
                                                } else {
                                                  vErrors.push(err19);
                                                }
                                                errors++;
                                                break;
                                              }
                                            }
                                            if (_errs71 === errors) {
                                              if (data28.code !== void 0) {
                                                let data29 = data28.code;
                                                const _errs72 = errors;
                                                if (errors === _errs72) {
                                                  if (typeof data29 === "string") {
                                                    if (func2(data29) < 1) {
                                                      const err20 = { instancePath: instancePath + "/error/code", schemaPath: "#/definitions/error/properties/code/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                                      if (vErrors === null) {
                                                        vErrors = [err20];
                                                      } else {
                                                        vErrors.push(err20);
                                                      }
                                                      errors++;
                                                    }
                                                  } else {
                                                    const err21 = { instancePath: instancePath + "/error/code", schemaPath: "#/definitions/error/properties/code/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                                    if (vErrors === null) {
                                                      vErrors = [err21];
                                                    } else {
                                                      vErrors.push(err21);
                                                    }
                                                    errors++;
                                                  }
                                                }
                                                var valid19 = _errs72 === errors;
                                              } else {
                                                var valid19 = true;
                                              }
                                              if (valid19) {
                                                if (data28.message !== void 0) {
                                                  let data30 = data28.message;
                                                  const _errs74 = errors;
                                                  if (errors === _errs74) {
                                                    if (typeof data30 === "string") {
                                                      if (func2(data30) < 1) {
                                                        const err22 = { instancePath: instancePath + "/error/message", schemaPath: "#/definitions/error/properties/message/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                                        if (vErrors === null) {
                                                          vErrors = [err22];
                                                        } else {
                                                          vErrors.push(err22);
                                                        }
                                                        errors++;
                                                      }
                                                    } else {
                                                      const err23 = { instancePath: instancePath + "/error/message", schemaPath: "#/definitions/error/properties/message/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                                      if (vErrors === null) {
                                                        vErrors = [err23];
                                                      } else {
                                                        vErrors.push(err23);
                                                      }
                                                      errors++;
                                                    }
                                                  }
                                                  var valid19 = _errs74 === errors;
                                                } else {
                                                  var valid19 = true;
                                                }
                                              }
                                            }
                                          }
                                        } else {
                                          const err24 = { instancePath: instancePath + "/error", schemaPath: "#/definitions/error/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                          if (vErrors === null) {
                                            vErrors = [err24];
                                          } else {
                                            vErrors.push(err24);
                                          }
                                          errors++;
                                        }
                                      }
                                      var _valid3 = _errs68 === errors;
                                      valid17 = valid17 || _valid3;
                                    }
                                    if (!valid17) {
                                      const err25 = { instancePath: instancePath + "/error", schemaPath: "#/properties/error/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
                                      if (vErrors === null) {
                                        vErrors = [err25];
                                      } else {
                                        vErrors.push(err25);
                                      }
                                      errors++;
                                      validate49.errors = vErrors;
                                      return false;
                                    } else {
                                      errors = _errs65;
                                      if (vErrors !== null) {
                                        if (_errs65) {
                                          vErrors.length = _errs65;
                                        } else {
                                          vErrors = null;
                                        }
                                      }
                                    }
                                    var valid16 = _errs64 === errors;
                                  } else {
                                    var valid16 = true;
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate49.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate49.errors = vErrors;
  return errors === 0;
}
var resourcePolicy = validate50;
function validate50(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.overscanFloors === void 0 && (missing0 = "overscanFloors") || data.historyCache === void 0 && (missing0 = "historyCache") || data.settledStreamCache === void 0 && (missing0 = "settledStreamCache") || data.diagnosticsCache === void 0 && (missing0 = "diagnosticsCache")) {
        validate50.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "overscanFloors" || key0 === "historyCache" || key0 === "settledStreamCache" || key0 === "diagnosticsCache")) {
            validate50.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.overscanFloors !== void 0) {
            let data0 = data.overscanFloors;
            const _errs2 = errors;
            if (!(typeof data0 == "number" && (!(data0 % 1) && !isNaN(data0)) && isFinite(data0))) {
              validate50.errors = [{ instancePath: instancePath + "/overscanFloors", schemaPath: "#/properties/overscanFloors/type", keyword: "type", params: { type: "integer" }, message: "must be integer" }];
              return false;
            }
            if (errors === _errs2) {
              if (typeof data0 == "number" && isFinite(data0)) {
                if (data0 < 0 || isNaN(data0)) {
                  validate50.errors = [{ instancePath: instancePath + "/overscanFloors", schemaPath: "#/properties/overscanFloors/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" }];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.historyCache !== void 0) {
              let data1 = data.historyCache;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
                  let missing1;
                  if (data1.maxEntries === void 0 && (missing1 = "maxEntries") || data1.maxBytes === void 0 && (missing1 = "maxBytes")) {
                    validate50.errors = [{ instancePath: instancePath + "/historyCache", schemaPath: "#/properties/historyCache/required", keyword: "required", params: { missingProperty: missing1 }, message: "must have required property '" + missing1 + "'" }];
                    return false;
                  } else {
                    const _errs6 = errors;
                    for (const key1 in data1) {
                      if (!(key1 === "maxEntries" || key1 === "maxBytes")) {
                        validate50.errors = [{ instancePath: instancePath + "/historyCache", schemaPath: "#/properties/historyCache/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" }];
                        return false;
                        break;
                      }
                    }
                    if (_errs6 === errors) {
                      if (data1.maxEntries !== void 0) {
                        let data2 = data1.maxEntries;
                        const _errs7 = errors;
                        if (!(typeof data2 == "number" && (!(data2 % 1) && !isNaN(data2)) && isFinite(data2))) {
                          validate50.errors = [{ instancePath: instancePath + "/historyCache/maxEntries", schemaPath: "#/properties/historyCache/properties/maxEntries/type", keyword: "type", params: { type: "integer" }, message: "must be integer" }];
                          return false;
                        }
                        if (errors === _errs7) {
                          if (typeof data2 == "number" && isFinite(data2)) {
                            if (data2 < 1 || isNaN(data2)) {
                              validate50.errors = [{ instancePath: instancePath + "/historyCache/maxEntries", schemaPath: "#/properties/historyCache/properties/maxEntries/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" }];
                              return false;
                            }
                          }
                        }
                        var valid1 = _errs7 === errors;
                      } else {
                        var valid1 = true;
                      }
                      if (valid1) {
                        if (data1.maxBytes !== void 0) {
                          let data3 = data1.maxBytes;
                          const _errs9 = errors;
                          if (!(typeof data3 == "number" && (!(data3 % 1) && !isNaN(data3)) && isFinite(data3))) {
                            validate50.errors = [{ instancePath: instancePath + "/historyCache/maxBytes", schemaPath: "#/properties/historyCache/properties/maxBytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" }];
                            return false;
                          }
                          if (errors === _errs9) {
                            if (typeof data3 == "number" && isFinite(data3)) {
                              if (data3 < 1 || isNaN(data3)) {
                                validate50.errors = [{ instancePath: instancePath + "/historyCache/maxBytes", schemaPath: "#/properties/historyCache/properties/maxBytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" }];
                                return false;
                              }
                            }
                          }
                          var valid1 = _errs9 === errors;
                        } else {
                          var valid1 = true;
                        }
                      }
                    }
                  }
                } else {
                  validate50.errors = [{ instancePath: instancePath + "/historyCache", schemaPath: "#/properties/historyCache/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                  return false;
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.settledStreamCache !== void 0) {
                let data4 = data.settledStreamCache;
                const _errs11 = errors;
                if (errors === _errs11) {
                  if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
                    let missing2;
                    if (data4.maxEntries === void 0 && (missing2 = "maxEntries") || data4.maxBytes === void 0 && (missing2 = "maxBytes")) {
                      validate50.errors = [{ instancePath: instancePath + "/settledStreamCache", schemaPath: "#/properties/settledStreamCache/required", keyword: "required", params: { missingProperty: missing2 }, message: "must have required property '" + missing2 + "'" }];
                      return false;
                    } else {
                      const _errs13 = errors;
                      for (const key2 in data4) {
                        if (!(key2 === "maxEntries" || key2 === "maxBytes")) {
                          validate50.errors = [{ instancePath: instancePath + "/settledStreamCache", schemaPath: "#/properties/settledStreamCache/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" }];
                          return false;
                          break;
                        }
                      }
                      if (_errs13 === errors) {
                        if (data4.maxEntries !== void 0) {
                          let data5 = data4.maxEntries;
                          const _errs14 = errors;
                          if (!(typeof data5 == "number" && (!(data5 % 1) && !isNaN(data5)) && isFinite(data5))) {
                            validate50.errors = [{ instancePath: instancePath + "/settledStreamCache/maxEntries", schemaPath: "#/properties/settledStreamCache/properties/maxEntries/type", keyword: "type", params: { type: "integer" }, message: "must be integer" }];
                            return false;
                          }
                          if (errors === _errs14) {
                            if (typeof data5 == "number" && isFinite(data5)) {
                              if (data5 < 1 || isNaN(data5)) {
                                validate50.errors = [{ instancePath: instancePath + "/settledStreamCache/maxEntries", schemaPath: "#/properties/settledStreamCache/properties/maxEntries/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" }];
                                return false;
                              }
                            }
                          }
                          var valid2 = _errs14 === errors;
                        } else {
                          var valid2 = true;
                        }
                        if (valid2) {
                          if (data4.maxBytes !== void 0) {
                            let data6 = data4.maxBytes;
                            const _errs16 = errors;
                            if (!(typeof data6 == "number" && (!(data6 % 1) && !isNaN(data6)) && isFinite(data6))) {
                              validate50.errors = [{ instancePath: instancePath + "/settledStreamCache/maxBytes", schemaPath: "#/properties/settledStreamCache/properties/maxBytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" }];
                              return false;
                            }
                            if (errors === _errs16) {
                              if (typeof data6 == "number" && isFinite(data6)) {
                                if (data6 < 1 || isNaN(data6)) {
                                  validate50.errors = [{ instancePath: instancePath + "/settledStreamCache/maxBytes", schemaPath: "#/properties/settledStreamCache/properties/maxBytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" }];
                                  return false;
                                }
                              }
                            }
                            var valid2 = _errs16 === errors;
                          } else {
                            var valid2 = true;
                          }
                        }
                      }
                    }
                  } else {
                    validate50.errors = [{ instancePath: instancePath + "/settledStreamCache", schemaPath: "#/properties/settledStreamCache/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                    return false;
                  }
                }
                var valid0 = _errs11 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.diagnosticsCache !== void 0) {
                  let data7 = data.diagnosticsCache;
                  const _errs18 = errors;
                  if (errors === _errs18) {
                    if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
                      let missing3;
                      if (data7.maxEntries === void 0 && (missing3 = "maxEntries") || data7.maxBytes === void 0 && (missing3 = "maxBytes")) {
                        validate50.errors = [{ instancePath: instancePath + "/diagnosticsCache", schemaPath: "#/properties/diagnosticsCache/required", keyword: "required", params: { missingProperty: missing3 }, message: "must have required property '" + missing3 + "'" }];
                        return false;
                      } else {
                        const _errs20 = errors;
                        for (const key3 in data7) {
                          if (!(key3 === "maxEntries" || key3 === "maxBytes")) {
                            validate50.errors = [{ instancePath: instancePath + "/diagnosticsCache", schemaPath: "#/properties/diagnosticsCache/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" }];
                            return false;
                            break;
                          }
                        }
                        if (_errs20 === errors) {
                          if (data7.maxEntries !== void 0) {
                            let data8 = data7.maxEntries;
                            const _errs21 = errors;
                            if (!(typeof data8 == "number" && (!(data8 % 1) && !isNaN(data8)) && isFinite(data8))) {
                              validate50.errors = [{ instancePath: instancePath + "/diagnosticsCache/maxEntries", schemaPath: "#/properties/diagnosticsCache/properties/maxEntries/type", keyword: "type", params: { type: "integer" }, message: "must be integer" }];
                              return false;
                            }
                            if (errors === _errs21) {
                              if (typeof data8 == "number" && isFinite(data8)) {
                                if (data8 < 1 || isNaN(data8)) {
                                  validate50.errors = [{ instancePath: instancePath + "/diagnosticsCache/maxEntries", schemaPath: "#/properties/diagnosticsCache/properties/maxEntries/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" }];
                                  return false;
                                }
                              }
                            }
                            var valid3 = _errs21 === errors;
                          } else {
                            var valid3 = true;
                          }
                          if (valid3) {
                            if (data7.maxBytes !== void 0) {
                              let data9 = data7.maxBytes;
                              const _errs23 = errors;
                              if (!(typeof data9 == "number" && (!(data9 % 1) && !isNaN(data9)) && isFinite(data9))) {
                                validate50.errors = [{ instancePath: instancePath + "/diagnosticsCache/maxBytes", schemaPath: "#/properties/diagnosticsCache/properties/maxBytes/type", keyword: "type", params: { type: "integer" }, message: "must be integer" }];
                                return false;
                              }
                              if (errors === _errs23) {
                                if (typeof data9 == "number" && isFinite(data9)) {
                                  if (data9 < 1 || isNaN(data9)) {
                                    validate50.errors = [{ instancePath: instancePath + "/diagnosticsCache/maxBytes", schemaPath: "#/properties/diagnosticsCache/properties/maxBytes/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" }];
                                    return false;
                                  }
                                }
                              }
                              var valid3 = _errs23 === errors;
                            } else {
                              var valid3 = true;
                            }
                          }
                        }
                      }
                    } else {
                      validate50.errors = [{ instancePath: instancePath + "/diagnosticsCache", schemaPath: "#/properties/diagnosticsCache/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
                      return false;
                    }
                  }
                  var valid0 = _errs18 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate50.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate50.errors = vErrors;
  return errors === 0;
}
var message = validate51;
var schema53 = { "type": "object", "properties": { "id": { "type": "string", "minLength": 1 }, "role": { "enum": ["user", "assistant", "agent"] }, "text": { "type": "string" }, "floorId": { "type": "string", "minLength": 1 }, "attemptId": { "type": "string", "minLength": 1 }, "streamId": { "type": "string", "minLength": 1 }, "status": { "enum": ["completed", "failed", "cancelled"] } }, "required": ["id", "role", "text", "floorId", "attemptId", "streamId", "status"], "additionalProperties": false };
function validate51(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.id === void 0 && (missing0 = "id") || data.role === void 0 && (missing0 = "role") || data.text === void 0 && (missing0 = "text") || data.floorId === void 0 && (missing0 = "floorId") || data.attemptId === void 0 && (missing0 = "attemptId") || data.streamId === void 0 && (missing0 = "streamId") || data.status === void 0 && (missing0 = "status")) {
        validate51.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "id" || key0 === "role" || key0 === "text" || key0 === "floorId" || key0 === "attemptId" || key0 === "streamId" || key0 === "status")) {
            validate51.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.id !== void 0) {
            let data0 = data.id;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate51.errors = [{ instancePath: instancePath + "/id", schemaPath: "#/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate51.errors = [{ instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.role !== void 0) {
              let data1 = data.role;
              const _errs4 = errors;
              if (!(data1 === "user" || data1 === "assistant" || data1 === "agent")) {
                validate51.errors = [{ instancePath: instancePath + "/role", schemaPath: "#/properties/role/enum", keyword: "enum", params: { allowedValues: schema53.properties.role.enum }, message: "must be equal to one of the allowed values" }];
                return false;
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.text !== void 0) {
                const _errs5 = errors;
                if (typeof data.text !== "string") {
                  validate51.errors = [{ instancePath: instancePath + "/text", schemaPath: "#/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
                var valid0 = _errs5 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.floorId !== void 0) {
                  let data3 = data.floorId;
                  const _errs7 = errors;
                  if (errors === _errs7) {
                    if (typeof data3 === "string") {
                      if (func2(data3) < 1) {
                        validate51.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                        return false;
                      }
                    } else {
                      validate51.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                      return false;
                    }
                  }
                  var valid0 = _errs7 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.attemptId !== void 0) {
                    let data4 = data.attemptId;
                    const _errs9 = errors;
                    if (errors === _errs9) {
                      if (typeof data4 === "string") {
                        if (func2(data4) < 1) {
                          validate51.errors = [{ instancePath: instancePath + "/attemptId", schemaPath: "#/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                          return false;
                        }
                      } else {
                        validate51.errors = [{ instancePath: instancePath + "/attemptId", schemaPath: "#/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                        return false;
                      }
                    }
                    var valid0 = _errs9 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.streamId !== void 0) {
                      let data5 = data.streamId;
                      const _errs11 = errors;
                      if (errors === _errs11) {
                        if (typeof data5 === "string") {
                          if (func2(data5) < 1) {
                            validate51.errors = [{ instancePath: instancePath + "/streamId", schemaPath: "#/properties/streamId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                            return false;
                          }
                        } else {
                          validate51.errors = [{ instancePath: instancePath + "/streamId", schemaPath: "#/properties/streamId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                          return false;
                        }
                      }
                      var valid0 = _errs11 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.status !== void 0) {
                        let data6 = data.status;
                        const _errs13 = errors;
                        if (!(data6 === "completed" || data6 === "failed" || data6 === "cancelled")) {
                          validate51.errors = [{ instancePath: instancePath + "/status", schemaPath: "#/properties/status/enum", keyword: "enum", params: { allowedValues: schema53.properties.status.enum }, message: "must be equal to one of the allowed values" }];
                          return false;
                        }
                        var valid0 = _errs13 === errors;
                      } else {
                        var valid0 = true;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate51.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate51.errors = vErrors;
  return errors === 0;
}
var messagesGetFloorParams = validate52;
function validate52(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (data.branchId === void 0 && (missing0 = "branchId") || data.floorId === void 0 && (missing0 = "floorId")) {
        validate52.errors = [{ instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!(key0 === "branchId" || key0 === "floorId" || key0 === "attemptId")) {
            validate52.errors = [{ instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.branchId !== void 0) {
            let data0 = data.branchId;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (func2(data0) < 1) {
                  validate52.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                  return false;
                }
              } else {
                validate52.errors = [{ instancePath: instancePath + "/branchId", schemaPath: "#/properties/branchId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.floorId !== void 0) {
              let data1 = data.floorId;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (typeof data1 === "string") {
                  if (func2(data1) < 1) {
                    validate52.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                    return false;
                  }
                } else {
                  validate52.errors = [{ instancePath: instancePath + "/floorId", schemaPath: "#/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                  return false;
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.attemptId !== void 0) {
                let data2 = data.attemptId;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (typeof data2 === "string") {
                    if (func2(data2) < 1) {
                      validate52.errors = [{ instancePath: instancePath + "/attemptId", schemaPath: "#/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                      return false;
                    }
                  } else {
                    validate52.errors = [{ instancePath: instancePath + "/attemptId", schemaPath: "#/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate52.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
      return false;
    }
  }
  validate52.errors = vErrors;
  return errors === 0;
}
var messagesGetFloorResult = validate53;
function validate53(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
  let vErrors = null;
  let errors = 0;
  if (errors === 0) {
    if (Array.isArray(data)) {
      var valid0 = true;
      const len0 = data.length;
      for (let i0 = 0; i0 < len0; i0++) {
        let data0 = data[i0];
        const _errs1 = errors;
        const _errs2 = errors;
        if (errors === _errs2) {
          if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
            let missing0;
            if (data0.id === void 0 && (missing0 = "id") || data0.role === void 0 && (missing0 = "role") || data0.text === void 0 && (missing0 = "text") || data0.floorId === void 0 && (missing0 = "floorId") || data0.attemptId === void 0 && (missing0 = "attemptId") || data0.streamId === void 0 && (missing0 = "streamId") || data0.status === void 0 && (missing0 = "status")) {
              validate53.errors = [{ instancePath: instancePath + "/" + i0, schemaPath: "#/definitions/message/required", keyword: "required", params: { missingProperty: missing0 }, message: "must have required property '" + missing0 + "'" }];
              return false;
            } else {
              const _errs4 = errors;
              for (const key0 in data0) {
                if (!(key0 === "id" || key0 === "role" || key0 === "text" || key0 === "floorId" || key0 === "attemptId" || key0 === "streamId" || key0 === "status")) {
                  validate53.errors = [{ instancePath: instancePath + "/" + i0, schemaPath: "#/definitions/message/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" }];
                  return false;
                  break;
                }
              }
              if (_errs4 === errors) {
                if (data0.id !== void 0) {
                  let data1 = data0.id;
                  const _errs5 = errors;
                  if (errors === _errs5) {
                    if (typeof data1 === "string") {
                      if (func2(data1) < 1) {
                        validate53.errors = [{ instancePath: instancePath + "/" + i0 + "/id", schemaPath: "#/definitions/message/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                        return false;
                      }
                    } else {
                      validate53.errors = [{ instancePath: instancePath + "/" + i0 + "/id", schemaPath: "#/definitions/message/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                      return false;
                    }
                  }
                  var valid2 = _errs5 === errors;
                } else {
                  var valid2 = true;
                }
                if (valid2) {
                  if (data0.role !== void 0) {
                    let data2 = data0.role;
                    const _errs7 = errors;
                    if (!(data2 === "user" || data2 === "assistant" || data2 === "agent")) {
                      validate53.errors = [{ instancePath: instancePath + "/" + i0 + "/role", schemaPath: "#/definitions/message/properties/role/enum", keyword: "enum", params: { allowedValues: schema53.properties.role.enum }, message: "must be equal to one of the allowed values" }];
                      return false;
                    }
                    var valid2 = _errs7 === errors;
                  } else {
                    var valid2 = true;
                  }
                  if (valid2) {
                    if (data0.text !== void 0) {
                      const _errs8 = errors;
                      if (typeof data0.text !== "string") {
                        validate53.errors = [{ instancePath: instancePath + "/" + i0 + "/text", schemaPath: "#/definitions/message/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                        return false;
                      }
                      var valid2 = _errs8 === errors;
                    } else {
                      var valid2 = true;
                    }
                    if (valid2) {
                      if (data0.floorId !== void 0) {
                        let data4 = data0.floorId;
                        const _errs10 = errors;
                        if (errors === _errs10) {
                          if (typeof data4 === "string") {
                            if (func2(data4) < 1) {
                              validate53.errors = [{ instancePath: instancePath + "/" + i0 + "/floorId", schemaPath: "#/definitions/message/properties/floorId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                              return false;
                            }
                          } else {
                            validate53.errors = [{ instancePath: instancePath + "/" + i0 + "/floorId", schemaPath: "#/definitions/message/properties/floorId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                            return false;
                          }
                        }
                        var valid2 = _errs10 === errors;
                      } else {
                        var valid2 = true;
                      }
                      if (valid2) {
                        if (data0.attemptId !== void 0) {
                          let data5 = data0.attemptId;
                          const _errs12 = errors;
                          if (errors === _errs12) {
                            if (typeof data5 === "string") {
                              if (func2(data5) < 1) {
                                validate53.errors = [{ instancePath: instancePath + "/" + i0 + "/attemptId", schemaPath: "#/definitions/message/properties/attemptId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                return false;
                              }
                            } else {
                              validate53.errors = [{ instancePath: instancePath + "/" + i0 + "/attemptId", schemaPath: "#/definitions/message/properties/attemptId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                              return false;
                            }
                          }
                          var valid2 = _errs12 === errors;
                        } else {
                          var valid2 = true;
                        }
                        if (valid2) {
                          if (data0.streamId !== void 0) {
                            let data6 = data0.streamId;
                            const _errs14 = errors;
                            if (errors === _errs14) {
                              if (typeof data6 === "string") {
                                if (func2(data6) < 1) {
                                  validate53.errors = [{ instancePath: instancePath + "/" + i0 + "/streamId", schemaPath: "#/definitions/message/properties/streamId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }];
                                  return false;
                                }
                              } else {
                                validate53.errors = [{ instancePath: instancePath + "/" + i0 + "/streamId", schemaPath: "#/definitions/message/properties/streamId/type", keyword: "type", params: { type: "string" }, message: "must be string" }];
                                return false;
                              }
                            }
                            var valid2 = _errs14 === errors;
                          } else {
                            var valid2 = true;
                          }
                          if (valid2) {
                            if (data0.status !== void 0) {
                              let data7 = data0.status;
                              const _errs16 = errors;
                              if (!(data7 === "completed" || data7 === "failed" || data7 === "cancelled")) {
                                validate53.errors = [{ instancePath: instancePath + "/" + i0 + "/status", schemaPath: "#/definitions/message/properties/status/enum", keyword: "enum", params: { allowedValues: schema53.properties.status.enum }, message: "must be equal to one of the allowed values" }];
                                return false;
                              }
                              var valid2 = _errs16 === errors;
                            } else {
                              var valid2 = true;
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          } else {
            validate53.errors = [{ instancePath: instancePath + "/" + i0, schemaPath: "#/definitions/message/type", keyword: "type", params: { type: "object" }, message: "must be object" }];
            return false;
          }
        }
        var valid0 = _errs1 === errors;
        if (!valid0) {
          break;
        }
      }
    } else {
      validate53.errors = [{ instancePath, schemaPath: "#/type", keyword: "type", params: { type: "array" }, message: "must be array" }];
      return false;
    }
  }
  validate53.errors = vErrors;
  return errors === 0;
}
export {
  assetMetadata,
  assetsListParams,
  assetsListResult,
  chatSendParams,
  chatSendResult,
  chatSetDraftParams,
  chatSetDraftResult,
  elementUpdate,
  error,
  floorPage,
  floorVariables,
  historyLatestParams,
  historyLatestResult,
  historyListFloorsParams,
  historyListFloorsResult,
  historySelectParams,
  historySelectResult,
  layoutPatch,
  layoutRegistration,
  mediaPlayParams,
  mediaPlayResult,
  message,
  messagesGetFloorParams,
  messagesGetFloorResult,
  packageSchema,
  record,
  resourcePolicy,
  snapshotSource,
  textStreamEvent,
  textStreamFilter,
  timerAfterDelay,
  timerEveryDelay,
  turnCommit,
  variablesGetFloorParams,
  variablesGetFloorResult,
  variablesGetSnapshotParams,
  variablesGetSnapshotResult
};
