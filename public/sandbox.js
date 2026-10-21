// HydraDAW — harness del sandbox de plugins (SEC-01).
// Documento estático servido como public/sandbox.js con CSP propia
// (default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none').
// Corre en un <iframe sandbox="allow-scripts"> sin allow-same-origin
// (origen opaco): sin DOM del padre, sin almacenamiento, sin red.
// La SESIÓN se adopta del primer mensaje válido del padre (no viene
// incrustada: este fichero es estático y compartido).
'use strict';
(function () {
var SESSION = null;
var NODE = {"gain":{"method":"createGain","params":["gain"],"props":{},"factoryArgs":0},"filter":{"method":"createBiquadFilter","params":["frequency","Q","gain"],"props":{"type":["lowpass","highpass","bandpass","lowshelf","highshelf","peaking","notch","allpass"]},"factoryArgs":0},"shaper":{"method":"createWaveShaper","params":[],"props":{"oversample":["none","2x","4x"]},"factoryArgs":0},"delay":{"method":"createDelay","params":["delayTime"],"props":{},"factoryArgs":1},"convolver":{"method":"createConvolver","params":[],"props":{},"factoryArgs":0},"comp":{"method":"createDynamicsCompressor","params":["threshold","knee","ratio","attack","release"],"props":{},"factoryArgs":0},"panner":{"method":"createStereoPanner","params":["pan"],"props":{},"factoryArgs":0},"osc":{"method":"createOscillator","params":["frequency","detune"],"props":{"type":["sine","square","sawtooth","triangle"]},"factoryArgs":0}};
var DEFAULTS = {"gain":{"gain":1},"filter":{"frequency":350,"Q":1,"gain":0},"delay":{"delayTime":0},"comp":{"threshold":-24,"knee":30,"ratio":12,"attack":0.003,"release":0.25},"panner":{"pan":0},"osc":{"frequency":440,"detune":0}};
var SCAN = [["\\b(globalThis|self|top|parent|frames|opener)\\b","i"],["\\b(location|navigator|history)\\b","i"],["\\b(Worker|SharedWorker|WebAssembly|importScripts)\\b","i"],["\\b(postMessage|indexedDB|caches|cookieStore)\\b","i"],["\\b(document|window|localStorage|sessionStorage)\\b","i"],["\\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\\b","i"],["\\beval\\b","i"],["\\bFunction\\b","i"],["\\bthis\\b",""],["\\bimport\\s*\\(","i"],["\\bimport\\.meta\\b","i"],["\\bprototype\\b","i"]];
var METHODS = ['setValue','setValueAtTime','setTargetAtTime','linearRampToValueAtTime','exponentialRampToValueAtTime'];
var OP_CAP_TEMPLATE = 512;
var OP_CAP_TOTAL = 2048;
var OP_CAP_RUNTIME = 64;
var MAX_PARAMS = 64;
var MAX_INSTANCES = 64;
var parentOrigin = null;
var plugins = {};
var instances = {};
var instanceCount = 0;
var handleSeq = 0;
function isNum(v) { return typeof v === "number" && isFinite(v); }
function isStr(v, max) { return typeof v === "string" && v.length <= max; }
function newHandle() { handleSeq += 1; return "h" + handleSeq; }
function post(evt, msg) {
  try { evt.source.postMessage(msg, parentOrigin || "*"); } catch (e) {}
}
function fail(evt, reqId, error) {
  post(evt, { type: "hydradaw-result", session: SESSION, reqId: reqId, ok: false, error: error });
}
function scan(code) {
  var low = code.toLowerCase();
  if (low.indexOf("constructor") !== -1 || low.indexOf("__proto__") !== -1) return "constructor/__proto__";
  for (var i = 0; i < SCAN.length; i++) {
    if (new RegExp(SCAN[i][0], SCAN[i][1]).test(code)) return SCAN[i][0];
  }
  return null;
}
function checkArgs(args, n) {
  if (!Array.isArray(args) || args.length !== n) throw new Error("argumentos inválidos");
  for (var i = 0; i < args.length; i++) if (!isNum(args[i])) throw new Error("argumento no finito");
  return args;
}
function emit(rec, op) {
  if (rec.ops.length >= OP_CAP_TOTAL) throw new Error("demasiadas operaciones");
  rec.ops.push(op);
}
function makeParam(rec, hid, ntype, pname) {
  function record(method, args) { emit(rec, { op: "param", handle: hid, param: pname, method: method, args: args }); }
  return {
    get value() { return rec.values[hid + "." + pname]; },
    set value(v) {
      if (!isNum(v)) throw new Error("valor de parámetro no finito");
      rec.values[hid + "." + pname] = v;
      record("setValue", [v]);
    },
    setValueAtTime: function (v, t) { record("setValueAtTime", checkArgs([v, t], 2)); },
    setTargetAtTime: function (v, t, tc) { record("setTargetAtTime", checkArgs([v, t, tc], 3)); },
    linearRampToValueAtTime: function (v, t) { record("linearRampToValueAtTime", checkArgs([v, t], 2)); },
    exponentialRampToValueAtTime: function (v, t) { record("exponentialRampToValueAtTime", checkArgs([v, t], 2)); }
  };
}
function makeFacade(rec, hid, ntype) {
  var spec = NODE[ntype];
  var f = { __hid: hid };
  for (var i = 0; i < spec.params.length; i++) (function (pname) {
    rec.values[hid + "." + pname] = DEFAULTS[ntype][pname];
    f[pname] = makeParam(rec, hid, ntype, pname);
  })(spec.params[i]);
  for (var prop in spec.props) (function (pname, rule) {
    var current = null;
    Object.defineProperty(f, pname, {
      enumerable: true, configurable: false,
      get: function () { return current; },
      set: function (v) {
        if (rule === "finite") { if (!isNum(v)) throw new Error("propiedad no finita para " + pname); }
        else if (rule.indexOf(v) === -1) throw new Error("valor fuera de la lista permitida para " + pname);
        current = v;
        emit(rec, { op: "set", handle: hid, prop: pname, value: v });
      }
    });
  })(prop, spec.props[prop]);
  f.connect = function (dest, out, inn) {
    if (!dest || typeof dest !== "object" || !isStr(dest.__hid, 8)) throw new Error("destino de connect inválido");
    var mop = { op: "connect", from: hid, to: dest.__hid };
    if (arguments.length > 1) {
      if (!Number.isInteger(out) || out < 0) throw new Error("índices de connect inválidos");
      mop.out = out;
      if (arguments.length > 2) {
        if (!Number.isInteger(inn) || inn < 0) throw new Error("índices de connect inválidos");
        mop.inn = inn;
      }
    }
    emit(rec, mop);
    return dest;
  };
  f.disconnect = function (dest) {
    var mop = { op: "disconnect", from: hid };
    if (dest !== undefined) {
      if (!dest || typeof dest !== "object" || !isStr(dest.__hid, 8)) throw new Error("destino de disconnect inválido");
      mop.to = dest.__hid;
    }
    emit(rec, mop);
  };
  try { Object.preventExtensions(f); } catch (e) {}
  return f;
}
function makeProxy(rec) {
  var ctx = {};
  for (var key in NODE) (function (ntype) {
    var spec = NODE[ntype];
    ctx[spec.method] = function () {
      var args = [];
      if (spec.factoryArgs > 0) {
        if (arguments.length > 1) throw new Error("demasiados argumentos para " + spec.method);
        if (arguments.length === 1) {
          if (!isNum(arguments[0])) throw new Error("argumento no finito para " + spec.method);
          args = [arguments[0]];
        }
      } else if (arguments.length > 0) {
        throw new Error("argumentos no permitidos para " + spec.method);
      }
      var hid = newHandle();
      emit(rec, { op: "create", node: ntype, handle: hid, args: args });
      return makeFacade(rec, hid, ntype);
    };
  })(key);
  try { Object.preventExtensions(ctx); } catch (e) {}
  return ctx;
}
function errText(e) { return e && e.message ? String(e.message) : String(e); }
function checkShape(def) {
  if (!def || typeof def !== "object") return "sin definición";
  if (typeof def.id !== "string" || !def.id || def.id.length > 64) return "id inválido";
  if (typeof def.createDSPNode !== "function") return "sin createDSPNode";
  if (def.parameters !== undefined && !Array.isArray(def.parameters)) return "parameters inválido";
  return null;
}
function checkParams(raw) {
  if (!Array.isArray(raw)) return "parameters debe ser un array";
  if (raw.length > MAX_PARAMS) return "demasiados parámetros";
  for (var i = 0; i < raw.length; i++) {
    var p = raw[i];
    if (!p || typeof p !== "object") return "parámetro inválido";
    if (!isStr(p.id, 64) || !p.id) return "parámetro sin id";
    if (!isStr(p.name, 128) || !p.name) return "parámetro sin nombre";
    if (!isNum(p.min) || !isNum(p.max) || !isNum(p.step) || !isNum(p.defaultValue)) return "rango no finito en " + p.id;
    if (!(p.min <= p.max) || !(p.step > 0)) return "rango incoherente en " + p.id;
    if (!(p.defaultValue >= p.min && p.defaultValue <= p.max)) return "default fuera de rango en " + p.id;
    if (p.unit !== undefined && !isStr(p.unit, 32)) return "unit inválida en " + p.id;
  }
  return null;
}
function isFacade(v) { return v && typeof v === "object" && isStr(v.__hid, 8); }
function onEvaluate(evt, d) {
  if (!isStr(d.reqId, 64) || typeof d.code !== "string") return;
  var hit = scan(d.code);
  if (hit) { fail(evt, d.reqId, "Código de plugin bloqueado por seguridad: " + hit); return; }
  var customPlugin = null;
  try {
    var factory = new Function("\"use strict\";\n" + d.code + "\n;return typeof customPlugin !== \"undefined\" ? customPlugin : null;");
    customPlugin = factory();
  } catch (e) { fail(evt, d.reqId, "El plugin falló al evaluarse: " + errText(e)); return; }
  var bad = checkShape(customPlugin);
  if (bad) { fail(evt, d.reqId, "El plugin local no exporta una definición válida (" + bad + ")."); return; }
  var params = Array.isArray(customPlugin.parameters) ? customPlugin.parameters : [];
  bad = checkParams(params);
  if (bad) { fail(evt, d.reqId, "Parámetros inválidos (" + bad + ")."); return; }
  var defaults = {};
  for (var i = 0; i < params.length; i++) defaults[params[i].id] = params[i].defaultValue;
  var rec = { ops: [], values: {} };
  var produced = null;
  try {
    produced = customPlugin.createDSPNode(makeProxy(rec), defaults);
  } catch (e) { fail(evt, d.reqId, "createDSPNode lanzó: " + errText(e)); return; }
  if (!produced || typeof produced !== "object" || !isFacade(produced.inputNode) || !isFacade(produced.outputNode)) {
    fail(evt, d.reqId, "inputNode/outputNode deben crearse con el proxy del sandbox."); return;
  }
  if (typeof produced.updateParameter !== "function") {
    fail(evt, d.reqId, "falta updateParameter."); return;
  }
  var split = rec.ops.length;
  try {
    for (var j = 0; j < params.length; j++) {
      var p = params[j];
      var alt = p.defaultValue !== p.max ? p.max : (p.defaultValue !== p.min ? p.min : p.defaultValue);
      var before = rec.ops.length;
      produced.updateParameter(p.id, p.defaultValue);
      produced.updateParameter(p.id, alt);
      var saw = false;
      for (var k = before; k < rec.ops.length; k++) if (rec.ops[k].op === "param") { saw = true; break; }
      if (!saw) { fail(evt, d.reqId, "el parámetro '" + p.id + "' debe responder a updateParameter."); return; }
    }
  } catch (e) { fail(evt, d.reqId, "updateParameter lanzó en la sonda: " + errText(e)); return; }
  if (split > OP_CAP_TEMPLATE) { fail(evt, d.reqId, "demasiadas operaciones en el template."); return; }
  if (rec.ops.length > OP_CAP_TOTAL) { fail(evt, d.reqId, "demasiadas operaciones en total."); return; }
  var serialParams = null;
  try { serialParams = JSON.parse(JSON.stringify(params)); }
  catch (e) { fail(evt, d.reqId, "parámetros no serializables."); return; }
  plugins[customPlugin.id] = { createDSPNode: customPlugin.createDSPNode };
  post(evt, { type: "hydradaw-result", session: SESSION, reqId: d.reqId, ok: true,
    descriptor: { id: customPlugin.id,
      name: typeof customPlugin.name === "string" ? customPlugin.name : "",
      category: typeof customPlugin.category === "string" ? customPlugin.category : "",
      description: typeof customPlugin.description === "string" ? customPlugin.description : "",
      parameters: serialParams },
    oplog: rec.ops.slice(0, split),
    input: produced.inputNode.__hid,
    output: produced.outputNode.__hid });
}
function onInstantiate(evt, d) {
  if (!isStr(d.pluginId, 64) || !isStr(d.instanceId, 128)) return;
  var plugin = plugins[d.pluginId];
  if (!plugin) return;
  if (instanceCount >= MAX_INSTANCES) return;
  if (!d.params || typeof d.params !== "object") return;
  var keys = Object.keys(d.params);
  if (keys.length > MAX_PARAMS) return;
  var params = {};
  var kept = [];
  for (var i = 0; i < keys.length; i++) {
    if (!isStr(keys[i], 64)) continue;
    var v = d.params[keys[i]];
    if (!isNum(v)) continue;
    params[keys[i]] = v;
    kept.push(keys[i]);
  }
  var rec = { ops: [], values: {} };
  var produced = null;
  try { produced = plugin.createDSPNode(makeProxy(rec), params); }
  catch (e) { return; }
  if (!produced || typeof produced !== "object" || typeof produced.updateParameter !== "function") return;
  instances[d.instanceId] = { update: produced.updateParameter, cleanup: produced.cleanup, rec: rec };
  instanceCount += 1;
  var sync = [];
  try {
    for (var j = 0; j < kept.length; j++) {
      produced.updateParameter(kept[j], params[kept[j]]);
    }
    for (var k = 0; k < rec.ops.length && sync.length < OP_CAP_RUNTIME; k++) sync.push(rec.ops[k]);
  } catch (e) { opsOut(evt, d.instanceId, sync, "updateParameter lanzó: " + errText(e)); return; }
  opsOut(evt, d.instanceId, sync, null);
}
function opsOut(evt, instanceId, ops, error) {
  var msg = { type: "hydradaw-ops", session: SESSION, instanceId: instanceId, ops: ops };
  if (error) msg.error = error;
  post(evt, msg);
}
function onUpdate(evt, d) {
  if (!isStr(d.instanceId, 128) || !isStr(d.paramId, 64) || !isNum(d.value)) return;
  var inst = instances[d.instanceId];
  if (!inst || typeof inst.update !== "function") return;
  inst.rec.ops = [];
  try { inst.update(d.paramId, d.value); }
  catch (e) { opsOut(evt, d.instanceId, [], "updateParameter lanzó: " + errText(e)); return; }
  if (inst.rec.ops.length > OP_CAP_RUNTIME) { opsOut(evt, d.instanceId, [], "demasiadas operaciones."); return; }
  opsOut(evt, d.instanceId, inst.rec.ops.slice(0), null);
}
function onDispose(evt, d) {
  if (!isStr(d.instanceId, 128)) return;
  var inst = instances[d.instanceId];
  if (!inst) return;
  delete instances[d.instanceId];
  instanceCount -= 1;
  try { if (typeof inst.cleanup === "function") inst.cleanup(); } catch (e) {}
}
window.addEventListener("message", function (event) {
  try {
    if (event.source !== window.parent) return;
    var d = event.data;
    if (!d || typeof d !== "object" || typeof d.type !== "string") return;
    if (SESSION === null) {
      if (typeof d.session !== "string" || !d.session || d.session.length > 64) return;
      SESSION = d.session;
    } else if (d.session !== SESSION) return;
    if (typeof d.origin === "string" && /^https?:\/\/[^/]+$/.test(d.origin)) parentOrigin = d.origin;
    if (d.type === "hydradaw-evaluate") onEvaluate(event, d);
    else if (d.type === "hydradaw-instantiate") onInstantiate(event, d);
    else if (d.type === "hydradaw-update") onUpdate(event, d);
    else if (d.type === "hydradaw-dispose") onDispose(event, d);
  } catch (e) {}
});
})();
