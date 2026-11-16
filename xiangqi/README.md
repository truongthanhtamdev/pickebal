# Kỳ Thủ Cờ Tướng

Phần mềm cờ tướng chạy trên trình duyệt: đấu với máy, xin gợi ý nước đi, phân tích lại cả ván, và luyện lại những nước mình từng đi sai.

Mở `index.html` qua một máy chủ web tĩnh, ví dụ:

```bash
cd xiangqi && python3 -m http.server 8000
```

rồi vào http://localhost:8000.

## Tính năng
- **Đấu với máy**: chọn cầm Đỏ hoặc Đen, bấm “Đổi bên” để đổi quân với máy ngay giữa ván; chỉnh thời gian máy nghĩ (0,5–25 giây/nước).
- **Hai người**: điều khiển cả hai bên trên cùng một máy, có tuỳ chọn tự xoay bàn để bên đến lượt luôn ở phía dưới.
- **Đánh giá điểm & gợi ý**: điểm thế cờ kèm lời nhận xét (cân bằng / nhỉnh hơn / ưu thế…), so sánh quân hai bên, và 3 nước tốt nhất có mũi tên đánh số, nhận xét ngắn, diễn biến dự kiến. Có thể bật gợi ý tự động mỗi khi đến lượt bạn.
- **Phân tích tự do**: tự đi cho cả hai bên (chép lại ván ngoài đời), máy liên tục chỉ nước tốt nhất.
- **Phân tích cả ván**: chấm từng nước (tốt nhất / tốt / thiếu chính xác / sai lầm / sai lầm nặng), độ chính xác của mỗi bên, biểu đồ ưu thế.
- **Luyện lại nước sai**: nước sai của bạn được lưu vào sổ, máy cho lại thế cờ để bạn tìm nước đúng.
- **Bộ nhớ học**: máy nhớ các thế cờ đã tính sâu, gặp lại thì đi ngay; xuất/nhập được để chuyển sang máy khác.
- **Xếp cờ, FEN, biên bản ICCS** (ví dụ `h2e2 h9g7`).

## Engine (`engine.js`)
Alpha-beta có iterative deepening, PVS, bảng băm (Zobrist), null-move, LMR, killer/history, quiescence, nối dài khi chiếu,
xử lý chiếu dai theo luật. Chạy trong Web Worker. Bộ sinh nước đã kiểm tra bằng perft từ thế ban đầu (44 / 1.920 / 79.666 / 3.290.240).
