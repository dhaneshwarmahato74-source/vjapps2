/* 16 strobe patterns. Each pattern: {id,name,length,at(step)->array of panel indices (0-7)}.
   Panel indices map 1:1 to processor sections: panel i -> output pixels i*500 .. i*500+499. */
(function () {
  'use strict';
  const D = window.DLS;
  const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
  const G = [[0, 1], [2, 3], [4, 5, 6], [7]];
  const seq = (arr) => ({ length: arr.length, at: (i) => arr[((i % arr.length) + arr.length) % arr.length] });
  const rev = (arr) => arr.slice().reverse();

  // spatial columns (x = -1 .. +1) of the 2-2-3-1 layout
  const cols = [[4], [0, 2], [5, 7], [1, 3], [6]];
  const rings = [[5], [2, 3], [4, 6], [0, 1, 7]]; // centre -> outside

  let lastSpark = [];
  const spark = {
    length: 8,
    at() {
      const n = 2 + Math.floor(Math.random() * 2);
      let pick;
      do {
        const pool = ALL.slice(); pick = [];
        while (pick.length < n) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      } while (pick.slice().sort().join() === lastSpark.slice().sort().join());
      lastSpark = pick;
      return pick;
    }
  };

  const list = [
    { id: 'whole', name: 'Whole Screen Flash', key: 'Q', ...seq([ALL]) },
    { id: 'zigzag', name: 'Zigzag', key: 'W', ...seq([[0], [1], [3], [2], [4], [5], [6], [7]]) },
    { id: 'tmb', name: 'Top → Middle → Bottom', key: 'E', ...seq([G[0], [2, 3, 4, 5, 6], G[3]]) },
    { id: 'bmt', name: 'Bottom → Middle → Top', key: 'R', ...seq([G[3], [2, 3, 4, 5, 6], G[0]]) },
    { id: 'ltr', name: 'Left → Right', key: 'T', ...seq(cols) },
    { id: 'rtl', name: 'Right → Left', key: 'Y', ...seq(rev(cols)) },
    { id: 'alt', name: 'Alternate Sides', key: 'U', ...seq([[0, 2, 4], [1, 3, 6], [5, 7]]) },
    { id: 'tvb', name: 'Top vs Bottom', key: 'I', ...seq([[0, 1, 2, 3], [4, 5, 6, 7]]) },
    { id: 'cout', name: 'Center Out', key: 'O', ...seq(rings) },
    { id: 'oin', name: 'Outside In', key: 'P', ...seq(rev(rings)) },
    { id: 'pair', name: 'Pair Chase', key: 'A', ...seq([[0, 1], [2, 3], [4, 5], [6, 7]]) },
    { id: 'spark', name: 'Random Spark', key: 'S', ...spark },
    { id: 'g4', name: 'Four-Group Chase', key: 'D', ...seq([G[0], G[1], G[2], G[3], G[2], G[1]]) },
    { id: 'build', name: 'Build-Up', key: 'G', ...seq([[0], [0, 1], [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6], ALL]) },
    { id: 'checker', name: 'Odd / Even Checker', key: 'H', ...seq([[0, 2, 4, 6], [1, 3, 5, 7]]) },
    { id: 'orbit', name: 'Orbit (clockwise)', key: 'J', ...seq([[0], [1], [3], [6], [7], [4], [2], [5]]) }
  ];

  // For thumbnails: brightness per panel = how early it appears in the sequence
  list.forEach((p) => {
    if (p.id === 'spark') { p.thumb = [1, 0.4, 0.8, 0.3, 0.9, 0.5, 0.2, 0.7]; return; }
    const t = new Array(8).fill(0.12);
    for (let s = 0; s < p.length; s++) p.at(s).forEach((i) => { if (t[i] === 0.12) t[i] = 1 - (s / Math.max(1, p.length)) * 0.85; });
    p.thumb = t;
  });

  D.patterns = { list, ALL, GROUPS: G };
})();
