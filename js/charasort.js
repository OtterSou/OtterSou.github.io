'use strict';

// Sorting algorithms

function* sorter(arr, k, d) {
    if (d > 2) {
        yield* multiTreeSorter(arr, k, d);
    } else if (k < arr.length / 5) {
        yield* heapSorter(arr, k);
    } else {
        yield* mergeSorter(arr, k, 0, arr.length);
    }
}

function* isLess(arr, i, j) {
    return (yield [arr[i], arr[j]])[0] == arr[i];
}

function* noOpSorter() {
    // does nothing
}

function* singleOpSorter(arr, d) {
    let n = Math.min(arr.length, d)
    let res = yield arr.slice(0, n);
    arr.splice(0, n, ...res);
}

function* mergeSorter(arr, k, a, b) {
    if (b - a <= 1) return;
    let m = Math.floor((a + b) / 2);
    yield* mergeSorter(arr, k, a, m);
    yield* mergeSorter(arr, k, m, b);
    let iend = Math.min(a + k, b);
    const arr2 = arr.slice(a, b);
    let [i1, i2, i] = [0, m - a, a];
    while (i < iend) {
        if (i1 == m - a) {
            arr.splice(i, iend - i, ...arr2.slice(i2, i2 + iend - i));
            break;
        } else if (i2 == b - a) {
            arr.splice(i, iend - i, ...arr2.slice(i1, i1 + iend - i));
            break;
        }
        if (yield* isLess(arr2, i1, i2)) {
            arr[i] = arr2[i1];
            i1 += 1;
        } else {
            arr[i] = arr2[i2];
            i2 += 1;
        }
        i += 1;
    }
}

function* heapSorter(arr, k) {
    function* downheap(i, k) {
        while (i < k) {
            let [top, lc, rc] = [i, i * 2 + 1, i * 2 + 2];
            if (lc < k && (yield* isLess(arr, top, lc))) {
                top = lc;
            }
            if (rc < k && (yield* isLess(arr, top, rc))) {
                top = rc;
            }
            if (top == i) {
                break;
            } else {
                [arr[i], arr[top]] = [arr[top], arr[i]];
                i = top;
            }
        }
    }
    // max-heapify first k items
    for (let i = k - 1; i >= 0; i--) {
        yield* downheap(i, k);
    }
    // compare with the rest
    for (let i = k; i < arr.length; i++) {
        if (yield* isLess(arr, i, 0)) {
            arr[0] = arr[i];
            yield* downheap(0, k);
        }
    }
    // heapsort
    for (let i = k - 1; i > 0; i--) {
        [arr[0], arr[i]] = [arr[i], arr[0]];
        yield* downheap(0, i);
    }
}

function* multiTreeSorter(arr, k, d) {
    let winCount = 0
    const map = {}
    const root = { children: [] };

    for (let x of arr) {
        const node = { value: x, children: [] };
        map[x] = node;
        root.children.push(node);
    }

    while (winCount < k) {
        // root has 1 child -> confirm winner and promote its children to root children
        while (root.children.length == 1) {
            const child = root.children[0];
            arr[winCount++] = child.value;
            root.children = child.children;
        }
        if (root.children.length < 2) continue;
        // traverse d nodes bfs-order and detach them from their parents
        const parents = [root];
        const elements = [];
        while (elements.length < d) {
            if (parents.length == 0) {
                break;
            } else if (parents[0].children.length > 0) {
                const node = parents[0].children.shift();
                elements.push(node.value);
                parents.push(node);
            } else {
                parents.shift();
            }
        }
        const result = yield elements;
        // daisy-chain compared nodes
        let tail = map[result[result.length - 1]];
        for (let i = result.length - 2; i >= 0; i--) {
            const node = map[result[i]];
            node.children.push(tail)
            tail = node
        }
        root.children.push(tail)
    }
}

// DOM
const entriesEl = document.getElementById('entries');
const kInput = document.getElementById('k-input');
const dInput = document.getElementById('d-input');
const startStopBtn = document.getElementById('start-stop-btn');
const statusEl = document.getElementById('status');
const compareGrid = document.getElementById('compare-grid');
const submitBtn = document.getElementById('submit-btn');
const resultEl = document.getElementById('result-area');

// states
let sortGen = null;
let arr = null;
let active = null;
let questionCount = 0;
let isRunning = false;
let activeCount = 0;
let k = 0;
let d = 2;

function collectEntry() {
    const lines = entriesEl.value.split('\n');
    const seen = new Set();
    const arr = [];
    for (const line of lines) {
        const item = line.trim();
        if (item && !seen.has(item)) {
            seen.add(item);
            arr.push(item);
        }
    }
    entriesEl.value = arr.join('\n')
    return arr;
}

function start() {
    k = Math.max(0, Math.floor(+kInput.value));
    kInput.value = k;
    d = Math.max(2, Math.floor(+dInput.value));
    dInput.value = d;
    arr = collectEntry();
    if (arr.length < 2) {
        statusEl.innerText = 'エントリーを2件以上入力してください'
        return;
    }
    // Fisher-Yates shuffle
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (k == 0) {
        k = arr.length
    } else if (k > arr.length) {
        k = arr.length;
        kInput.value = k;
    }
    statusEl.innerText = arr.length + '件をソート';

    isRunning = true;
    questionCount = 0;
    entriesEl.disabled = true;
    kInput.disabled = true;
    dInput.disabled = true;
    startStopBtn.innerText = '中止';
    resultEl.value = '';
    sortGen = sorter(arr, k, d);
    submitBtn.disabled = false;
    prepareComparison(sortGen.next());
}

function stop() {
    isRunning = false;
    sortGen = null;
    entriesEl.disabled = false;
    kInput.disabled = false;
    dInput.disabled = false;
    startStopBtn.innerText = '開始';
    statusEl.innerText = '中止しました';
    compareGrid.innerHTML = '';
    submitBtn.disabled = true;
    compareGrid.innerHTML = '';
}

function prepareComparison(result) {
    if (result.done) {
        finished();
        return;
    }
    questionCount++;
    statusEl.innerText = 'Q' + questionCount + '.';
    active = result.value;
    renderTable();
}

function renderTable() {
    compareGrid.innerHTML = ''
    active.forEach((item, index) => {
        const rankDiv = document.createElement('div');
        rankDiv.innerText = (index + 1) + '.';
        compareGrid.appendChild(rankDiv);

        const btnDiv = document.createElement('div');
        const upBtn = document.createElement('button');
        upBtn.innerText = '↑';
        upBtn.disabled = index == 0;
        upBtn.addEventListener('click', () => {
            [active[index - 1], active[index]] = [active[index], active[index - 1]];
            renderTable();
        });
        btnDiv.appendChild(upBtn);
        const downBtn = document.createElement('button');
        downBtn.innerText = '↓';
        downBtn.disabled = index == active.length - 1;
        downBtn.addEventListener('click', () => {
            [active[index], active[index + 1]] = [active[index + 1], active[index]];
            renderTable();
        });
        btnDiv.appendChild(downBtn);
        compareGrid.appendChild(btnDiv);

        const nameDiv = document.createElement('div');
        nameDiv.innerText = item;
        compareGrid.appendChild(nameDiv);

    })
}

function finished() {
    isRunning = false;
    sortGen = null;
    entriesEl.disabled = false;
    kInput.disabled = false;
    dInput.disabled = false;
    startStopBtn.innerText = '開始';
    statusEl.innerText = '完了';
    compareGrid.innerHTML = '';
    submitBtn.disabled = true;
    const resultText = [];
    for (let i = 0; i < k; i++) {
        resultText.push((i + 1) + '. ' + arr[i]);
    }
    resultEl.value = resultText.join('\n');
}

startStopBtn.addEventListener('click', () => {
    if (isRunning) {
        stop();
    } else {
        start();
    }
})

submitBtn.addEventListener('click', () => {
    prepareComparison(sortGen.next(active));
})
