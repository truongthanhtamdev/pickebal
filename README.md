# Aurelia – Vancouver Private Journeys (demo)

Website demo tour riêng VIP Vancouver – Whistler – Vancouver Island, giao diện sang trọng tông tối + đồng thau.

## Xem website
Mở trực tiếp `index.html` bằng trình duyệt (cần internet để tải font, ảnh, clip),
hoặc bật GitHub Pages: Settings → Pages → Deploy from branch.

## Các phần
Hero video · Triết lý · 3 hành trình signature (giá CAD) · Trải nghiệm độc quyền · Thước phim (xem toàn màn hình) ·
Lịch trình mẫu 6 ngày · Thư viện ảnh (lightbox, phím ← →) · Dịch vụ VIP · Mùa du lịch · Đánh giá mẫu · Form đặt tư vấn (demo).

## Thay ảnh / clip
- Clip: đặt file vào `assets/video/` (xem README trong đó), hoặc sửa mảng `FILMS` trong `<script>` của `index.html`.
- Ảnh thư viện: sửa mảng `GALLERY` (ID ảnh Unsplash hoặc tự đổi hàm `U()` sang đường dẫn ảnh của bạn).
- Ảnh các khối khác: sửa thuộc tính `--img:url('...')` trong HTML.
- Nếu một link ảnh không tải được, khối đó tự hiện nền gradient thay vì ô trống.

Tên thương hiệu, số điện thoại, email, giá và đánh giá đều là dữ liệu mẫu.
