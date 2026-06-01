/**
 * S2 geometry for spherical cell grids (ported from IITC regions / pogo-s2).
 * @see https://gitlab.com/NvlblNm/pogo-s2
 */
(function (global) {
  "use strict";

  const d2r = Math.PI / 180.0;
  const r2d = 180.0 / Math.PI;

  function latLngToXyz(latLng) {
    const phi = latLng.lat * d2r;
    const theta = latLng.lng * d2r;
    const cosPhi = Math.cos(phi);
    return [
      Math.cos(theta) * cosPhi,
      Math.sin(theta) * cosPhi,
      Math.sin(phi),
    ];
  }

  function xyzToLatLng(xyz) {
    const lat = Math.atan2(
      xyz[2],
      Math.sqrt(xyz[0] * xyz[0] + xyz[1] * xyz[1])
    );
    const lng = Math.atan2(xyz[1], xyz[0]);
    return { lat: lat * r2d, lng: lng * r2d };
  }

  function largestAbsComponent(xyz) {
    const temp = [Math.abs(xyz[0]), Math.abs(xyz[1]), Math.abs(xyz[2])];
    if (temp[0] > temp[1]) {
      return temp[0] > temp[2] ? 0 : 2;
    }
    return temp[1] > temp[2] ? 1 : 2;
  }

  function faceXyzToUv(face, xyz) {
    let u;
    let v;
    switch (face) {
      case 0:
        u = xyz[1] / xyz[0];
        v = xyz[2] / xyz[0];
        break;
      case 1:
        u = -xyz[0] / xyz[1];
        v = xyz[2] / xyz[1];
        break;
      case 2:
        u = -xyz[0] / xyz[2];
        v = -xyz[1] / xyz[2];
        break;
      case 3:
        u = xyz[2] / xyz[0];
        v = xyz[1] / xyz[0];
        break;
      case 4:
        u = xyz[2] / xyz[1];
        v = -xyz[0] / xyz[1];
        break;
      case 5:
        u = -xyz[1] / xyz[2];
        v = -xyz[0] / xyz[2];
        break;
      default:
        throw new Error("Invalid face");
    }
    return [u, v];
  }

  function xyzToFaceUv(xyz) {
    let face = largestAbsComponent(xyz);
    if (xyz[face] < 0) {
      face += 3;
    }
    const uv = faceXyzToUv(face, xyz);
    return [face, uv];
  }

  function faceUvToXyz(face, uv) {
    const u = uv[0];
    const v = uv[1];
    switch (face) {
      case 0:
        return [1, u, v];
      case 1:
        return [-u, 1, v];
      case 2:
        return [-u, -v, 1];
      case 3:
        return [-1, -v, -u];
      case 4:
        return [v, -1, -u];
      case 5:
        return [v, u, -1];
      default:
        throw new Error("Invalid face");
    }
  }

  function stToUv(st) {
    function single(stValue) {
      if (stValue >= 0.5) {
        return (1 / 3.0) * (4 * stValue * stValue - 1);
      }
      return (1 / 3.0) * (1 - 4 * (1 - stValue) * (1 - stValue));
    }
    return [single(st[0]), single(st[1])];
  }

  function uvToSt(uv) {
    function single(uvValue) {
      if (uvValue >= 0) {
        return 0.5 * Math.sqrt(1 + 3 * uvValue);
      }
      return 1 - 0.5 * Math.sqrt(1 - 3 * uvValue);
    }
    return [single(uv[0]), single(uv[1])];
  }

  function stToIj(st, order) {
    const maxSize = 1 << order;
    function single(stValue) {
      const ij = Math.floor(stValue * maxSize);
      return Math.max(0, Math.min(maxSize - 1, ij));
    }
    return [single(st[0]), single(st[1])];
  }

  function ijToSt(ij, order, offsets) {
    const maxSize = 1 << order;
    return [
      (ij[0] + offsets[0]) / maxSize,
      (ij[1] + offsets[1]) / maxSize,
    ];
  }

  function S2Cell() {}

  S2Cell.fromLatLng = function (latLng, level) {
    const xyz = latLngToXyz(latLng);
    const faceUv = xyzToFaceUv(xyz);
    const st = uvToSt(faceUv[1]);
    const ij = stToIj(st, level);
    return S2Cell.fromFaceIj(faceUv[0], ij, level);
  };

  S2Cell.fromFaceIj = function (face, ij, level) {
    const cell = new S2Cell();
    cell.face = face;
    cell.ij = ij;
    cell.level = level;
    return cell;
  };

  S2Cell.prototype.toString = function () {
    return `F${this.face}ij[${this.ij[0]},${this.ij[1]}]@${this.level}`;
  };

  S2Cell.prototype.getLatLng = function () {
    const st = ijToSt(this.ij, this.level, [0.5, 0.5]);
    const uv = stToUv(st);
    const xyz = faceUvToXyz(this.face, uv);
    return xyzToLatLng(xyz);
  };

  S2Cell.prototype.getCornerLatLngs = function () {
    const offsets = [
      [0.0, 0.0],
      [0.0, 1.0],
      [1.0, 1.0],
      [1.0, 0.0],
    ];
    return offsets.map((offset) => {
      const st = ijToSt(this.ij, this.level, offset);
      const uv = stToUv(st);
      const xyz = faceUvToXyz(this.face, uv);
      return xyzToLatLng(xyz);
    });
  };

  S2Cell.prototype.getNeighbors = function (deltas) {
    function fromFaceIjWrap(face, ij, level) {
      const maxSize = 1 << level;
      if (ij[0] >= 0 && ij[1] >= 0 && ij[0] < maxSize && ij[1] < maxSize) {
        return S2Cell.fromFaceIj(face, ij, level);
      }
      let st = ijToSt(ij, level, [0.5, 0.5]);
      let uv = stToUv(st);
      const xyz = faceUvToXyz(face, uv);
      const wrapped = xyzToFaceUv(xyz);
      face = wrapped[0];
      uv = wrapped[1];
      st = uvToSt(uv);
      ij = stToIj(st, level);
      return S2Cell.fromFaceIj(face, ij, level);
    }

    const face = this.face;
    const i = this.ij[0];
    const j = this.ij[1];
    const level = this.level;

    if (!deltas) {
      deltas = [
        { a: -1, b: 0 },
        { a: 0, b: -1 },
        { a: 1, b: 0 },
        { a: 0, b: 1 },
      ];
    }

    return deltas.map((delta) =>
      fromFaceIjWrap(face, [i + delta.a, j + delta.b], level)
    );
  };

  global.WayfarerS2 = { S2Cell };
})(typeof window !== "undefined" ? window : globalThis);
