// backend/utils/time.js

// Hàm này trả về chuỗi thời gian hiện tại theo giờ VN,
// định dạng chuẩn MySQL: YYYY-MM-DD HH:mm:ss
const getVietnamTime = () => {
    // Lấy thời gian hiện tại, ép về múi giờ VN
    const date = new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" });
    const vnDate = new Date(date);

    // Format lại thành YYYY-MM-DD HH:mm:ss để lưu vào MySQL
    const year = vnDate.getFullYear();
    // getMonth() trả về 0-11 nên cần +1. padStart(2, '0') để thêm số 0 đằng trước nếu cần (ví dụ tháng 5 -> '05')
    const month = String(vnDate.getMonth() + 1).padStart(2, '0');
    const day = String(vnDate.getDate()).padStart(2, '0');
    const hours = String(vnDate.getHours()).padStart(2, '0');
    const minutes = String(vnDate.getMinutes()).padStart(2, '0');
    const seconds = String(vnDate.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

module.exports = { getVietnamTime };