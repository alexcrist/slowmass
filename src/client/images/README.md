# Local image decoding

Avatar and post cropping share size/type checks and orientation-aware bitmap decoding. Inputs are limited to JPEG, PNG, or WebP, 8 MB, and 40 megapixels. Callers own bitmap lifetime, close it on replacement/unmount, and ignore late decodes. Files and previews remain in memory. These checks serve the UI; the server remains authoritative for every upload.
