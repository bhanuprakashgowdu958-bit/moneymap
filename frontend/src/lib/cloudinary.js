// Cloudinary unsigned upload helper
// Docs: https://cloudinary.com/documentation/upload_images#unsigned_upload

const CLOUD_NAME   = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

/**
 * Upload a file to Cloudinary using an unsigned upload preset.
 * @param {File} file - The file to upload
 * @param {string} folder - Cloudinary folder path, e.g. "moneymap/avatars"
 * @returns {Promise<{url: string, publicId: string}>}
 */
export async function uploadToCloudinary(file, folder = 'moneymap/uploads') {
  // Demo Mode fallback: if Cloudinary is unconfigured, store as local data URL
  if (!CLOUD_NAME || !UPLOAD_PRESET || CLOUD_NAME === 'your_cloud_name' || CLOUD_NAME.startsWith('your_')) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({
          url: reader.result,
          publicId: `demo_receipt_${Date.now()}`,
        });
      };
      reader.readAsDataURL(file);
    });
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', folder);

  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      { method: 'POST', body: formData }
    );

    if (!response.ok) {
      const err = await response.json();
      console.warn('Cloudinary upload error, falling back to local data URL:', err);
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({
            url: reader.result,
            publicId: `local_fallback_${Date.now()}`,
          });
        };
        reader.readAsDataURL(file);
      });
    }

    const data = await response.json();
    return {
      url:      data.secure_url,
      publicId: data.public_id,
    };
  } catch (err) {
    console.warn('Cloudinary network exception, falling back to local data URL:', err);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({
          url: reader.result,
          publicId: `local_fallback_${Date.now()}`,
        });
      };
      reader.readAsDataURL(file);
    });
  }
}

/**
 * Get a Cloudinary URL with transformations applied.
 * @param {string} publicId
 * @param {Object} options - { width, height, crop, quality }
 */
export function getCloudinaryUrl(publicId, options = {}) {
  if (!CLOUD_NAME || !publicId) return '';
  const { width = 200, height = 200, crop = 'fill', quality = 'auto' } = options;
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/w_${width},h_${height},c_${crop},q_${quality}/${publicId}`;
}
