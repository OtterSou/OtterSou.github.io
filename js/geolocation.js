'use strict';

// DOM
const startStopBtn = document.getElementById('start-stop-btn');
const spanLatLon = document.getElementById('latlon');
const spanSpeed = document.getElementById('speed');
const selSpeed = document.getElementById('speed-sel');
const spanAlt = document.getElementById('alt');
const selAlt = document.getElementById('alt-sel');
const spanAlt2 = document.getElementById('alt2');
const selRef = document.getElementById('ref-sel');
const cbAddress = document.getElementById('address-cb');
const spanAddress = document.getElementById('address');

const UNITS = {
    speed: {
        mps: { label: 'm/s', scale: 1.0 },
        kph: { label: 'km/h', scale: 1 / 3.6 },
        mph: { label: 'mph', scale: 1.609344 / 3.6 },
        kn: { label: 'knot', scale: 1.852 / 3.6 },
    },
    alt: {
        m: { label: 'm', scale: 1.0 },
        ft: { label: 'ft', scale: 0.3048 },
    },
};
const COMPASS = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW', 'N',
];

const LOCATION_OPTIONS = {
    maximumAge: 1000,
    enableHighAccuracy: true,
};

function deg2dms(deg) {
    let x = Math.round(Math.abs(deg) * 36000);
    let dsec = x % 600;
    x = (x - dsec) / 600;
    let min = x % 60;
    deg = (x - min) / 60;
    const parts = [
        deg, '°', min < 10 ? '0' : '', min, '\'',
        dsec < 100 ? '0' : '', (dsec / 10).toFixed(1), '"'
    ];
    return parts.join('');
};

function distance(param1, param2) {
    const R = 6371008; // mean radius
    let dlat = (param2.latitude - param1.latitude) * Math.PI / 180;
    let mlat = (param1.latitude + param2.latitude) * Math.PI / 180;
    let dlon = (param2.longitude - param1.longitude) * Math.PI / 180 * Math.cos(mlat);
    let distance = R * Math.hypot(dlon, dlat);
    let heading = (Math.atan2(dlon, dlat) * 180 / Math.PI + 360) % 360;
    return { distance: distance, heading: heading };
}

function latlon2tile(latlon, z) {
    let wx = (latlon.longitude / 360 + 0.5) * 2 ** z * 256;
    let wy = (0.5 - Math.asinh(Math.tan(latlon.latitude * Math.PI / 180)) / (2 * Math.PI))
        * 2 ** z * 256;
    let tx = Math.floor(wx / 256);
    let ty = Math.floor(wy / 256);
    return {
        x: tx,
        y: ty,
        px: Math.floor(wx - tx * 256),
        py: Math.floor(wy - ty * 256),
    };
}

const CachedRequest = {
    cache: new Map(),
    fetch: function (url) {
        if (!this.cache.has(url)) {
            console.log('fetch', url);
            const promise = fetch(url)
                .catch(err => {
                    this.cache.delete(url);
                    throw err;
                });
            this.cache.set(url, promise);
        };
        return this.cache.get(url).then(res => res.clone());
    },
};

const EGM2008 = {
    cache: new Map(),
    fetch_xy: function (x, y) {
        const url = `/tile/egm2008/5/${x}/${y}.png`;
        if (this.cache.has(url)) {
            return this.cache.get(url);
        };
        const promise = CachedRequest.fetch(url)
            .then(res => res.blob())
            .then(this.imblob2arr)
            .catch(err => {
                this.cache.delete(url);
                throw err;
            });
        this.cache.set(url, promise);
        return promise;
    },
    decodePixel: function (r, g, b) {
        return (((r - (r >= 128 ? 256 : 0)) * 256 + g) * 256 + b) / 100
    },
    imblob2arr: function (blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = function () {
                try {
                    const canvas = document.createElement('canvas');
                    const width = img.width;
                    const height = img.height;
                    canvas.width = width
                    canvas.height = height

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const imageData = ctx.getImageData(0, 0, width, height);
                    const data = imageData.data;

                    const result = new Array(height);
                    let i = 0
                    for (let y = 0; y < height; y++) {
                        const row = new Array(width);
                        for (let x = 0; x < width; x++) {
                            row[x] = EGM2008.decodePixel(
                                data[i], data[i + 1], data[i + 2]);
                            i += 4;
                        }
                        result[y] = row;
                    }
                    resolve(result);
                } catch (e) {
                    reject(e)
                };
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(blob);
        });
    },
    getUndulation: function (latlon) {
        const txy = latlon2tile(latlon, 5);
        if (txy.y < 0 || txy.y >= 32) {
            return Promise.reject(new Error('latitude outside XYZ tile range'));
        }
        return this.fetch_xy(txy.x, txy.y).then(
            tile => tile[txy.py][txy.px]
        )
    },
}

const AddressFinder = {
    lastFeature: null,
    isPointInPolygon: function (x, y, poly) {
        let wn = 0;
        let p1 = poly[0];
        let p2 = null;
        for (let i = 1; i < poly.length; i++) {
            p2 = poly[i];
            if (p1[1] <= y && p2[1] > y) {
                let t = (y - p1[1]) / (p2[1] - p1[1]);
                if (x < p1[0] + t * (p2[0] - p1[0])) {
                    wn++;
                }
            } else if (p1[1] > y && p2[1] <= y) {
                let t = (y - p1[1]) / (p2[1] - p1[1]);
                if (x < p1[0] + t * (p2[0] - p1[0])) {
                    wn--;
                }
            }
            p1 = p2;
        }
        return wn != 0;
    },
    isPointInFeature: function (x, y, feat) {
        let coord = feat.geometry.coordinates;
        if (feat.geometry.type != 'MultiPolygon') {
            coord = [coord];
        };
        for (const hpoly of coord) {
            let hit = this.isPointInPolygon(x, y, hpoly[0]);
            for (let i = 1; hit && i < hpoly.length; i++) {
                hit = !this.isPointInPolygon(x, y, hpoly[i]);
            }
            if (hit) return true;
        }
        return false;
    },
    formatFeature: function (feat) {
        if (feat == null) {
            return '-';
        } else {
            const props = feat.properties;
            return `<ruby>${props.pref}<rt>${props.pref_kana}</rt></ruby> 
<ruby>${props.muni}<rt>${props.muni_kana}</rt></ruby>
<ruby>${props.LV01}<rt>${props.Lv01_kana}</rt></ruby>`;
        };
    },
    findAddress: function (latlon) {
        const [lat, lon] = [latlon.latitude, latlon.longitude];
        if (this.lastFeature != null && this.isPointInFeature(lon, lat, this.lastFeature)) {
            return Promise.resolve(this.lastFeature).then(this.formatFeature);
        };
        const txy = latlon2tile(latlon, 14);
        const url = `https://cyberjapandata.gsi.go.jp/xyz/lv01_plg/14/${txy.x}/${txy.y}.geojson`;
        // const url = './6451.geojson';
        return CachedRequest.fetch(url)
            .then(res => {
                if (res.ok) {
                    return res.json();
                } else {
                    throw new Error('failed to fetch address tile');
                };
            })
            .then(tile => {
                if (tile == null) return null;
                for (const feat of tile.features) {
                    if (this.isPointInFeature(lon, lat, feat)) {
                        this.lastFeature = feat;
                        return feat;
                    };
                };
            })
            .then(this.formatFeature)
            .catch(console.error);
    },
}

const GPS = {
    isActive: false,
    id: null,
    params: null,
    toggleActive: function () {
        if (this.isActive) {
            this.isActive = false;
            navigator.geolocation.clearWatch(this.id);
            startStopBtn.textContent = 'Start';
            console.log('GPS paused');
        } else {
            this.isActive = true;
            this.id = navigator.geolocation.watchPosition(this.onSuccess, this.onError, LOCATION_OPTIONS);
            startStopBtn.textContent = 'Stop';
            spanLatLon.textContent = 'Waiting for a position...';
            console.log('GPS started');
        }
    },
    onSuccess: function (pos) {
        const params = pos.toJSON().coords;
        params.timestamp = pos.timestamp;
        let dh = null;
        if (GPS.params == null) {
            params.dt = null;
        } else {
            params.dt = (params.timestamp - GPS.params.timestamp) / 1000;
            dh = distance(GPS.params, params);
        };
        params.realSpeed = params.speed != null;
        if (params.speed == null && dh != null) {
            params.speed = dh.distance / params.dt;
        };
        params.realHeading = params.heading != null;
        if (params.heading == null && dh != null) {
            params.heading = dh.heading;
        };
        if (selRef.value == 'none') {
            params.undulation = null;
        } else {
            params.undulation = EGM2008.getUndulation(params);
        }
        if (cbAddress.checked) {
            params.address = AddressFinder.findAddress(params);
        } else {
            params.address = null;
        }
        console.log(params);
        GPS.params = params;
        GPS.updateDisplay();
    },
    onError: function (err) {
        console.error(err.code, err.message);
        spanLatLon.textContent = 'Error: ' + err.message;
        GPS.params = null;
        spanSpeed.textContent = '-';
        spanAlt.textContent = '-';
    },
    updateDisplay: function () {
        // console.log('update');
        if (GPS.params == null) return;
        const params = GPS.params;
        const parts = [];
        let speedUnit = UNITS.speed[selSpeed.value];
        let altUnit = UNITS.alt[selAlt.value];

        // latlon
        parts.push(deg2dms(params.latitude));
        parts.push(params.latitude >= 0 ? 'N' : 'S');
        parts.push(' ');
        parts.push(deg2dms(params.longitude));
        parts.push(params.longitude >= 0 ? 'E' : 'W');
        parts.push(' ± ' + (params.accuracy / altUnit.scale).toFixed() + ' ' + altUnit.label);
        parts.push('\n');
        parts.push(params.latitude.toFixed(5) + ', ' + params.longitude.toFixed(5));
        spanLatLon.textContent = parts.join('');

        // speed
        parts.splice(0);
        if (params.speed == null) {
            parts.push('-');
        } else {
            if (params.heading != null && params.speed >= 1.0) {
                parts.push(params.heading.toFixed() + '°');
                let compass = COMPASS[Math.round(params.heading / 22.5)];
                parts.push(' (' + compass + ')');
                parts.push(params.realHeading ? ' ' : '* ');
            };
            parts.push((params.speed / speedUnit.scale).toFixed(1));
            parts.push(params.realSpeed ? ' ' : '* ');
        };
        spanSpeed.textContent = parts.join('');

        // altitude
        parts.splice(0);
        if (params.altitude == null) {
            spanAlt.textContent = '-';
        } else {
            parts.push((GPS.params.altitude / altUnit.scale).toFixed());
            if (GPS.params.altitudeAccuracy != null) {
                parts.push('± ' + (GPS.params.altitudeAccuracy / altUnit.scale).toFixed());
            };
            spanAlt.textContent = parts.join(' ');

            if (selRef.value == 'none' || params.undulation == null) {
                spanAlt2.textContent = '';
            } else {
                params.undulation.then(und => {
                    let alt2 = params.altitude;
                    let otherRef = '';
                    if (selRef.value == 'geoid') {
                        alt2 += und;
                        otherRef = 'Ellipsoid';
                    } else {
                        alt2 -= und;
                        otherRef = 'Geoid';
                    }
                    const parts = [',', (alt2 / altUnit.scale).toFixed(),
                        altUnit.label, otherRef];
                    spanAlt2.textContent = parts.join(' ');
                }).catch(e => {
                    spanAlt2.textContent = '';
                });
            };
        };

        spanAddress.hidden = !cbAddress.checked;
        // address
        if (!cbAddress.checked || params.address == null) {
            spanAddress.textContent = '-';
        } else {
            params.address.then(addr => {
                spanAddress.innerHTML = addr;
            }).catch(e => {
                spanAddress.textContent = '-';

            })
        }

    },
    moveTo: function (lat, lon, alt = null) {
        const params = {
            timestamp: Date.now(),
            coords: {
                latitude: lat,
                longitude: lon,
                altitude: alt,
                accuracy: 100,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
            },
        }
        params.toJSON = () => params;
        this.onSuccess(params);
    },
};

for (const k in UNITS.speed) {
    const elem = document.createElement('option');
    elem.value = k;
    elem.textContent = UNITS.speed[k].label;
    selSpeed.appendChild(elem);
}
for (const k in UNITS.alt) {
    const elem = document.createElement('option');
    elem.value = k;
    elem.textContent = UNITS.alt[k].label;
    selAlt.appendChild(elem);
}
// GPS.toggleActive();
