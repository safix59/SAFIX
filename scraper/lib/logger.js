import fs from "node:fs";
import path from "node:path";

export class Logger {
  constructor(logDir) {
    this.logDir = logDir;
    fs.mkdirSync(logDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.runFile = path.join(logDir, `run-${stamp}.log`);
    this.changesFile = path.join(logDir, "changes.log");
    this.errorsFile = path.join(logDir, "errors.log");
  }

  _ts() {
    return new Date().toISOString();
  }

  _write(file, line) {
    fs.appendFileSync(file, line + "\n");
  }

  info(msg) {
    const line = `[${this._ts()}] [INFO] ${msg}`;
    console.log(line);
    this._write(this.runFile, line);
  }

  warn(msg) {
    const line = `[${this._ts()}] [WARN] ${msg}`;
    console.warn(line);
    this._write(this.runFile, line);
  }

  error(msg, err) {
    const detail = err ? ` :: ${err.message || err}` : "";
    const line = `[${this._ts()}] [ERROR] ${msg}${detail}`;
    console.error(line);
    this._write(this.runFile, line);
    this._write(this.errorsFile, line);
  }

  change(repairId, model, oldVal, newVal) {
    const line = `[${this._ts()}] ${repairId} / ${model} : ${JSON.stringify(oldVal)} -> ${JSON.stringify(newVal)}`;
    console.log("[CHANGE] " + line);
    this._write(this.changesFile, line);
    this._write(this.runFile, "[CHANGE] " + line);
  }
}
