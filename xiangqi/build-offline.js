#!/usr/bin/env node
/*
 * Đóng gói Kỳ Thủ Cờ Tướng thành MỘT file HTML chơi offline (không cần mạng, không cần máy chủ).
 *
 *   node build-offline.js [fonts.css]
 *
 * fonts.css (tuỳ chọn): các @font-face đã nhúng sẵn dạng data: URI. Có thì chữ hiển thị giống hệt bản web;
 * không có thì trang dùng phông có sẵn trên máy.
 * Kết quả: ky-thu-co-tuong-offline.html cạnh file này.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const fontsCss = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : '';

let html = read('index.html');

// Bỏ phông tải từ Google; thay bằng phông nhúng (nếu có)
html = html.replace(/<link rel="preconnect"[^>]*>\n?/g, '');
html = html.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\n?/g, '');
if (fontsCss) html = html.replace('<style>', `<style>\n${fontsCss}\n</style>\n<style>`);

// Nhúng các file script vào trang. Engine giữ id để tạo Web Worker từ chính mã của nó.
const inline = (file, id) => {
  const src = read(file);
  if (src.includes('</script')) throw new Error(file + ' chứa "</script", không nhúng được');
  return `<script${id ? ` id="${id}"` : ''}>\n${src}\n</script>`;
};
html = html.replace('<script src="engine.js"></script>', () => inline('engine.js', 'engine-src'));
html = html.replace('<script src="openings.js"></script>', () => inline('openings.js'));
html = html.replace('<script src="app.js"></script>', () => inline('app.js'));
if (/<script src=/.test(html)) throw new Error('Còn script ngoài chưa được nhúng');

html = '<!doctype html>\n<html lang="vi">\n' + html + '\n</html>\n';
const out = path.join(dir, 'ky-thu-co-tuong-offline.html');
fs.writeFileSync(out, html);
console.log('Đã tạo', out, Math.round(html.length / 1024) + ' KB');
