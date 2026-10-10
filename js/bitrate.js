"use strict";

const inputExpr = document.getElementById("expr");
const spanResult = document.getElementById("result");

const TOKEN_RE = /(\d+(?:\.\d*)?|\.\d+)|(?:([kKMGT]i?)?([hms]|[bB](?:ps)?))|([()+\-*/])/y;
const TIME = { h: 3600, m: 60, s: 1 };
const POWER = { k: 1, K: 1, M: 2, G: 3, T: 4 };

function tokenize(input) {
    function unit(mult, body) {
        let v = 1;
        if (mult) {
            const base = mult.length > 1 || mult[0] === "K" ? 1024 : 1000;
            v = base ** POWER[mult[0]];
        }
        const c = body[0];
        if (c in TIME) return { v: v * TIME[c], b: 0, s: 1 };
        v *= c === "B" ? 8 : 1;
        if (body.length === 1) return { v, b: 1, s: 0 };
        return { v: v / TIME[body[2]], b: 1, s: -1 };
    }

    const tokens = [];
    let pos = 0;
    while (true) {
        while (pos < input.length && input[pos] === " ") pos++;
        if (pos >= input.length) break;

        TOKEN_RE.lastIndex = pos;
        const m = TOKEN_RE.exec(input);
        if (!m) {
            throw new SyntaxError(`Unexpected character '${input[pos]}' at position ${pos}`);
        } else if (m[1] !== undefined) {
            tokens.push({ t: "num", q: { v: parseFloat(m[1]), b: 0, s: 0 }, pos });
        } else if (m[3] !== undefined) {
            tokens.push({ t: "unit", q: unit(m[2], m[3]), pos });
        } else {
            tokens.push({ t: "op", op: m[4], pos });
        }
        pos = TOKEN_RE.lastIndex;
    }
    return tokens;
}

function evaluate(tokens) {
    const add = (a, b, sign) => {
        if (a.b !== b.b || a.s !== b.s) {
            throw new TypeError(`Cannot add b^${a.b} s^${a.s} and b^${b.b} s^${b.s}`);
        }
        return { v: a.v + sign * b.v, b: a.b, s: a.s };
    };
    const mul = (a, b) => ({ v: a.v * b.v, b: a.b + b.b, s: a.s + b.s });
    const div = (a, b) => ({ v: a.v / b.v, b: a.b - b.b, s: a.s - b.s });
    const neg = (a) => ({ v: -a.v, b: a.b, s: a.s });

    let i = 0;
    const peek = () => tokens[i];
    const isOp = (t, ...ops) => t && t.t === "op" && ops.includes(t.op);
    const startsPrimary = (t) => t && (t.t === "num" || t.t === "unit" || isOp(t, "("));
    function expr() {
        let left = term();
        while (isOp(peek(), "+", "-")) {
            const op = tokens[i++].op;
            left = add(left, term(), op === "+" ? 1 : -1);
        }
        return left;
    }
    function term() {
        let left = unary();
        while (isOp(peek(), "*", "/")) {
            const op = tokens[i++].op;
            const right = unary();
            left = op === "*" ? mul(left, right) : div(left, right);
        }
        return left;
    }
    function unary() {
        if (isOp(peek(), "+", "-")) {
            const op = tokens[i++].op;
            const x = unary();
            return op === "-" ? neg(x) : x;
        }
        return concat();
    }
    function concat() {
        let sum = primary();
        while (startsPrimary(peek())) sum = add(sum, primary(), 1);
        return sum;
    }
    function primary() {
        const t = tokens[i];
        if (!t) throw new SyntaxError("Unexpected end of expression");

        if (t.t === "num") {
            i++;
            if (peek() && peek().t === "unit") return mul(t.q, tokens[i++].q);
            return t.q;
        }
        if (t.t === "unit") {
            i++;
            return t.q;
        }
        if (isOp(t, "(")) {
            i++;
            const inner = expr();
            if (!isOp(peek(), ")")) {
                throw new SyntaxError(`Expected ')' ${peek() ? `at position ${peek().pos}` : "at end"}`);
            }
            i++;
            return inner;
        }
        throw new SyntaxError(`Unexpected '${t.op}' at position ${t.pos}`);
    }
    console.log(tokens);
    if (tokens.length === 0) throw new SyntaxError("Empty expression"); // This shouldn't happen
    const result = expr();
    if (i < tokens.length) {
        const t = tokens[i];
        throw new SyntaxError(`Unexpected '${t.op ?? "token"}' at position ${t.pos}`);
    }
    return result;
}
function format(q, cfg) {
    function to_mul(v) {
        // to_mul(1572864) -> [1.5, 'Mi']
        const base = cfg.binary ? 1024 : 1000;
        let power = 0;
        let unit;
        for (unit of ["", "k", "M", "G", "T"]) {
            if (v < base || unit === "T") break;
            v /= base;
        }
        if (unit === "") {
            // do nothing
        } else if (unit === "k" && cfg.binary) {
            unit = "K";
        } else if (cfg.binary) {
            unit += "i";
        }
        console.log(v, unit);
        return [v, unit];
    }
    const parts = [];
    let sign = q.v < 0 ? "-" : "",
        v = Math.abs(q.v),
        unit;
    if (q.b == 1 && q.s == 0) {
        // info
        if (cfg.byte) v /= 8;
        [v, unit] = to_mul(v);
        parts.push(v, unit + (cfg.byte ? "B" : "b"));
    } else if (q.b == 0 && q.s == 1) {
        if (cfg.dectime) {
            for (unit of ["s", "m", "h"]) {
                if (v < 60 || unit == "h") break;
                v /= 60;
            }
            parts.push(v, unit);
        } else {
            parts.splice(0, 0, (v % 60) + "s");
            v = Math.floor(v / 60);
            if (v > 0) {
                parts.splice(0, 0, (v % 60) + "m");
            }
            v = Math.floor(v / 60);
            if (v > 0) {
                parts.splice(0, 0, v + "h");
            }
        }
    } else if (q.b == 1 && q.s == -1) {
        // rate
        if (cfg.byte) v /= 8;
        [v, unit] = to_mul(v);
        parts.push(v, unit + (cfg.byte ? "B/s" : "bps"));
    } else {
        // other
        parts.push(v);
        if (q.b != 0) {
            parts.push(`b<sup>${q.b}</sup>`);
        }
        if (q.s != 0) {
            parts.push(`s<sup>${q.s}</sup>`);
        }
    }
    return sign + parts.join(" ");
}

function collect() {
    const cfg = {};
    cfg.byte = document.querySelector('input[name="info"]:checked').value === "byte";
    cfg.binary = document.getElementById("binary").checked;
    cfg.dectime = document.getElementById("dectime").checked;
    console.log(cfg);
    return cfg;
}

function run() {
    const expr = inputExpr.value;
    let result;
    try {
        const cfg = collect();
        const tokens = tokenize(expr);
        if (tokens.length == 0) {
            spanResult.innerText = "Enter an expression";
        } else {
            // result = JSON.stringify(tokens);
            const quantity = evaluate(tokens);
            console.log(quantity);
            spanResult.innerHTML = "= " + format(quantity, cfg);
        }
    } catch (e) {
        spanResult.innerText = e.message;
        throw e;
    }
}

inputExpr.addEventListener("input", () => {
    run();
});
document.getElementById("config").addEventListener("change", () => {
    run();
});

document.querySelectorAll("#examples li").forEach((elem) => {
    elem.addEventListener("click", () => {
        inputExpr.value = elem.dataset.text;
        run();
    });
});
