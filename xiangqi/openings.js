/*
 * Thư viện khai cuộc cơ bản. Mỗi bài: bên người học (0 = Đỏ đi tiên, 1 = Đen đi sau),
 * dãy nước theo ký hiệu ICCS, kèm lời giảng cho từng nước.
 * Ký hiệu kiểu Việt Nam (P2-5, M8.7…) được phần mềm tự tính từ ICCS.
 */
(function (root) {
  'use strict';
  const OPENINGS = [
    {
      id: 'phao-dau-xe-qua-ha', side: 0, family: 'Pháo đầu đối Bình phong mã',
      name: 'Pháo đầu Xe quá hà', level: 'Cơ bản',
      desc: 'Khai cuộc tấn công kinh điển của bên đi tiên: pháo vào giữa, lên mã giữ tốt đầu, ra xe thật nhanh rồi đưa xe qua sông gây sức ép.',
      moves: [
        ['h2e2', 'Pháo đầu (P2-5): đưa pháo vào trung lộ, nhắm thẳng tốt đầu và tướng đối phương. Đây là nước mở màn tấn công phổ biến nhất.'],
        ['h9g7', 'Đen lên mã bảo vệ tốt đầu, bước đầu của thế Bình phong mã.'],
        ['h0g2', 'Mã 2 tiến 3: lên mã giữ tốt đầu của mình và mở đường cho xe bên phải ra trận.'],
        ['i9h9', 'Đen bình xe sang cột 8 (xe trực) để ra xe sớm.'],
        ['i0h0', 'Xe 1 bình 2: xe đứng ở cột mở, sẵn sàng tiến lên. Nguyên tắc vàng: ra xe càng sớm càng tốt.'],
        ['g6g5', 'Đen tiến tốt 7, mở lối cho mã 7 và không cho xe Đỏ dễ dàng ăn tốt.'],
        ['h0h6', 'Xe 2 tiến 6 (xe quá hà): xe vượt sông, đứng ở hàng tuần hà của Đen, kìm chân mã và tốt cánh 7 của đối phương.'],
        ['b9c7', 'Đen lên nốt mã trái: hai mã đứng cạnh nhau như tấm bình phong che trung lộ.'],
        ['b0c2', 'Mã 8 tiến 7: phát triển nốt mã trái. Cả hai mã đã ra, trung lộ được giữ chắc.'],
        ['c9e7', 'Đen lên tượng củng cố trung tâm.'],
        ['c3c4', 'Tốt 7 tiến 1: mở đường cho mã 7 tiến lên, chuẩn bị đưa nốt xe 9 và pháo 8 vào trận.'],
      ],
    },
    {
      id: 'phao-dau-thuan-phao', side: 0, family: 'Pháo đầu đối Thuận pháo',
      name: 'Pháo đầu gặp Thuận pháo', level: 'Cơ bản',
      desc: 'Khi Đen cũng đưa pháo vào giữa cùng phía, hai bên đối công trực diện. Việc đầu tiên là giữ chắc tốt đầu, sau đó ra xe.',
      moves: [
        ['h2e2', 'Pháo đầu (P2-5).'],
        ['h7e7', 'Đen cũng đưa pháo vào giữa cùng phía với bạn (Thuận pháo): lối chơi đối công.'],
        ['h0g2', 'Mã 2 tiến 3: hai pháo đầu đang nhắm nhau qua hai tốt đầu, nên phải lên mã giữ tốt đầu ngay.'],
        ['h9g7', 'Đen cũng lên mã giữ tốt đầu.'],
        ['i0h0', 'Xe 1 bình 2: ra xe trực, nhắm thẳng vào cột của pháo 8 bên Đen.'],
        ['i9i8', 'Đen ra xe ngang (xe hoành) để chuyển nhanh sang cánh khác.'],
        ['b0c2', 'Mã 8 tiến 7: lên mã trái, hai mã cùng bảo vệ trung lộ.'],
        ['i8d8', 'Xe Đen bình sang cột 4, chuẩn bị tiến sâu bên cánh trái của bạn.'],
        ['h0h4', 'Xe 2 tiến 4 (xe tuần hà): xe đứng ở bờ sông phía mình, vừa chặn xe Đen vừa sẵn sàng tấn công.'],
      ],
    },
    {
      id: 'phao-dau-phan-cung-ma', side: 0, family: 'Pháo đầu đối Phản cung mã',
      name: 'Pháo đầu gặp Phản cung mã', level: 'Nâng cao',
      desc: 'Đen đặt một pháo vào lòng sĩ, hai mã chia hai bên. Bạn giữ thế Pháo đầu, ra xe, và dùng tốt 3 để kiềm chế mã Đen.',
      moves: [
        ['h2e2', 'Pháo đầu (P2-5).'],
        ['b9c7', 'Đen lên mã 2 trước để giữ tốt đầu.'],
        ['h0g2', 'Mã 2 tiến 3: giữ tốt đầu, mở đường ra xe.'],
        ['h7f7', 'Đen bình pháo 8 sang cột 6, đứng trong lòng sĩ: dấu hiệu của Phản cung mã.'],
        ['i0h0', 'Xe 1 bình 2: ra xe trực. Pháo 8 Đen đã rời cột 8 nên xe của bạn có cột thông để tiến.'],
        ['h9g7', 'Đen lên mã còn lại: hai mã hai bên, pháo ở giữa, gọi là Phản cung mã.'],
        ['g3g4', 'Tốt 3 tiến 1: mở đường cho mã 3 và kiềm chế mã 7 của Đen.'],
        ['g9e7', 'Đen lên tượng củng cố trung lộ.'],
        ['b0c2', 'Mã 8 tiến 7: phát triển nốt mã trái, sẵn sàng đưa xe 9 ra.'],
      ],
    },
    {
      id: 'binh-phong-ma', side: 1, family: 'Pháo đầu đối Bình phong mã',
      name: 'Bình phong mã chống Pháo đầu', level: 'Cơ bản',
      desc: 'Thế phòng thủ vững chắc nhất của bên đi sau: hai mã đứng cạnh nhau giữ tốt đầu, xe ra sớm, tượng củng cố trung lộ, rồi tìm cơ hội đổi xe để giải toả sức ép.',
      moves: [
        ['h2e2', 'Đỏ đi Pháo đầu, nhắm vào tốt đầu của bạn.'],
        ['h9g7', 'Mã 8 tiến 7: việc đầu tiên khi gặp Pháo đầu là dùng mã bảo vệ tốt đầu.'],
        ['h0g2', 'Đỏ lên mã.'],
        ['i9h9', 'Xe 9 bình 8 (xe trực): ra xe sớm, xe nhìn thẳng xuống cột 8 của Đỏ.'],
        ['i0h0', 'Đỏ ra xe trực.'],
        ['g6g5', 'Tốt 7 tiến 1: mở lối cho mã 7 và không cho xe Đỏ dễ dàng ăn tốt.'],
        ['h0h6', 'Đỏ đưa xe qua sông (xe quá hà), gây sức ép lên cánh 7 của bạn.'],
        ['b9c7', 'Mã 2 tiến 3: lên nốt mã trái để hoàn thành Bình phong mã. Hai mã cùng giữ chặt tốt đầu.'],
        ['b0c2', 'Đỏ lên mã trái.'],
        ['c9e7', 'Tượng 3 tiến 5: củng cố trung lộ, nối liền hai tượng.'],
        ['c3c4', 'Đỏ tiến tốt 7.'],
        ['h7i7', 'Pháo 8 bình 9: dọn cột 8 để xe 8 của bạn đối mặt với xe Đỏ, buộc Đỏ phải đổi xe hoặc lui xe.'],
      ],
    },
    {
      id: 'thuan-phao', side: 1, family: 'Pháo đầu đối Thuận pháo',
      name: 'Thuận pháo đánh trả Pháo đầu', level: 'Cơ bản',
      desc: 'Đáp Pháo đầu bằng Pháo đầu cùng phía. Lối chơi chủ động, phản công ngay: giữ tốt đầu bằng mã, rồi ra xe ngang để xe chiếm cột trống.',
      moves: [
        ['h2e2', 'Đỏ đi Pháo đầu.'],
        ['h7e7', 'Pháo 8 bình 5 (Thuận pháo): đưa pháo vào giữa cùng phía với Đỏ, đối công trực diện.'],
        ['h0g2', 'Đỏ lên mã.'],
        ['h9g7', 'Mã 8 tiến 7: giữ tốt đầu. Pháo đầu Đỏ đang nhắm thẳng vào tốt này.'],
        ['i0h0', 'Đỏ ra xe trực.'],
        ['i9i8', 'Xe 9 tiến 1 (xe hoành): ra xe theo hàng ngang để chuyển nhanh sang cột trống.'],
        ['b0c2', 'Đỏ lên mã trái.'],
        ['i8d8', 'Xe 9 bình 4: xe chiếm cột 4, chuẩn bị tiến sâu vào cánh trái của Đỏ.'],
      ],
    },
    {
      id: 'doi-binh', side: 1, family: 'Tiên nhân chỉ lộ',
      name: 'Đối binh chống Tiên nhân chỉ lộ', level: 'Cơ bản',
      desc: 'Khi Đỏ mở bằng tốt 7 tiến 1 (Tiên nhân chỉ lộ), bạn tiến tốt đối lại rồi vẫn dựng thế Bình phong mã quen thuộc.',
      moves: [
        ['c3c4', 'Đỏ đi Tiên nhân chỉ lộ (tốt 7 tiến 1): khai cuộc mềm, thăm dò ý đồ của bạn.'],
        ['g6g5', 'Tốt 7 tiến 1 (đối binh): đáp lại bằng một nước tốt cân xứng, giữ thế cân bằng và mở lối cho mã.'],
        ['b0c2', 'Đỏ lên mã.'],
        ['h9g7', 'Mã 8 tiến 7: phát triển mã ngay sau tốt vừa tiến.'],
        ['h2e2', 'Đỏ chuyển sang Pháo đầu, nhắm tốt đầu.'],
        ['b9c7', 'Mã 2 tiến 3: hoàn thành Bình phong mã, hai mã giữ chặt tốt đầu.'],
        ['h0g2', 'Đỏ lên nốt mã phải.'],
        ['i9h9', 'Xe 9 bình 8 (xe trực): ra xe sớm, hoàn tất khai cuộc với thế cờ vững vàng.'],
      ],
    },
  ];

  const PRINCIPLES = [
    'Ra xe sớm: xe là quân mạnh nhất, để xe nằm ở góc là lãng phí.',
    'Lên mã giữ tốt đầu trước khi tấn công, nhất là khi đối phương có Pháo đầu.',
    'Không đi một quân nhiều lần khi các quân khác còn chưa ra trận.',
    'Giữ trung lộ: pháo, mã, tượng, sĩ ở giữa bàn quyết định an toàn của tướng.',
    'Đừng tham ăn tốt khi chưa ra đủ quân: một tốt đổi lấy vài nước chậm là lỗ.',
  ];

  root.XQ_OPENINGS = { OPENINGS, PRINCIPLES };
})(typeof self !== 'undefined' ? self : globalThis);
