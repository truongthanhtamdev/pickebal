# Kỳ Thủ Cờ Tướng

Phần mềm cờ tướng chạy trên trình duyệt: đấu với máy, xin gợi ý nước đi, phân tích lại cả ván, và luyện lại những nước mình từng đi sai.

Mở `index.html` qua một máy chủ web tĩnh, ví dụ:

```bash
cd xiangqi && python3 -m http.server 8000
```

rồi vào http://localhost:8000.

## Tính năng
- **Đấu với máy**: chọn cầm Đỏ hoặc Đen, chỉnh thời gian máy nghĩ (0,5–25 giây/nước).
- **Gợi ý**: mũi tên xanh chỉ nước tốt nhất, mũi tên xám là nước đáp dự kiến của đối phương; kèm điểm thế cờ và diễn biến dự kiến.
- **Phân tích tự do**: tự đi cho cả hai bên (chép lại ván ngoài đời), máy liên tục chỉ nước tốt nhất.
- **Phân tích cả ván**: chấm từng nước (tốt nhất / tốt / thiếu chính xác / sai lầm / sai lầm nặng), độ chính xác của mỗi bên, biểu đồ ưu thế.
- **Luyện lại nước sai**: nước sai của bạn được lưu vào sổ, máy cho lại thế cờ để bạn tìm nước đúng.
- **Bộ nhớ học**: máy nhớ các thế cờ đã tính sâu, gặp lại thì đi ngay; xuất/nhập được để chuyển sang máy khác.
- **Xếp cờ, FEN, biên bản ICCS** (ví dụ `h2e2 h9g7`).

## Engine (`engine.js`)
Alpha-beta có iterative deepening, PVS, bảng băm (Zobrist), null-move, LMR, killer/history, quiescence, nối dài khi chiếu,
xử lý chiếu dai theo luật. Chạy trong Web Worker. Bộ sinh nước đã kiểm tra bằng perft từ thế ban đầu (44 / 1.920 / 79.666 / 3.290.240).
