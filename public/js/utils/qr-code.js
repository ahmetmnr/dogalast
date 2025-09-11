/**
 * QR Code Utility
 * Simple QR code generation for sharing quiz links
 */

export class QRCodeGenerator {
  /**
   * Generate QR code for quiz URL
   */
  static async generateQuizQR(quizUrl, size = 200) {
    try {
      // Using a simple QR code service or library
      const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(quizUrl)}`;
      
      return {
        success: true,
        qrCodeUrl: qrApiUrl,
        downloadUrl: qrApiUrl + '&download=1'
      };
      
    } catch (error) {
      console.error('QR code generation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create QR code element
   */
  static createQRElement(quizUrl, options = {}) {
    const {
      size = 200,
      className = 'qr-code',
      alt = 'Quiz QR Kodu'
    } = options;

    const img = document.createElement('img');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(quizUrl)}`;
    img.alt = alt;
    img.className = className;
    img.style.width = `${size}px`;
    img.style.height = `${size}px`;

    return img;
  }
}

export default QRCodeGenerator;

