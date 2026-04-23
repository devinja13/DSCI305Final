import rasterio
from rasterio.warp import reproject, Resampling
import numpy as np

houston_path = r"C:\Users\cuime\Downloads\DLAB-Forestry\ForUSTree_2018_HighVeg_TreeCoverage.tif"
texas_path = r"C:\Users\cuime\Downloads\DLAB-Forestry\NOAA_CCAP_Impervious_2021.tif"
output_path = r"C:\Users\cuime\Downloads\DLAB-Forestry\texas_clipped.tif"

print("Script started")

# Reproject + Align
with rasterio.open(houston_path) as houston:
    
    houston_meta = houston.meta.copy()
    houston_meta.update({
        "dtype": "float32",
        "count": 1
    })

    destination_array = np.zeros((houston.height, houston.width), dtype="float32")

    with rasterio.open(texas_path) as texas:
        reproject(
            source=rasterio.band(texas, 1),
            destination=destination_array,
            src_transform=texas.transform,
            src_crs=texas.crs,
            dst_transform=houston.transform,
            dst_crs=houston.crs,
            resampling=Resampling.bilinear
        )

    with rasterio.open(output_path, "w", **houston_meta) as dst:
        dst.write(destination_array, 1)

print("texas_clipped.tif successfully written.")

# Check Align
print("\nChecking Alignment")

with rasterio.open(output_path) as t:
    print("Texas clipped:")
    print("  CRS:", t.crs)
    print("  Size:", t.width, t.height)
    print("  Transform:", t.transform)

with rasterio.open(houston_path) as h:
    print("\nHouston canopy:")
    print("  CRS:", h.crs)
    print("  Size:", h.width, h.height)
    print("  Transform:", h.transform)

'''Texas clipped: 
CRS: EPSG:6344 
Size: 1542 1376 
Transform: | 50.01, 0.00, 237912.00| 
| 0.00,-50.01, 3334954.00| 
| 0.00, 0.00, 1.00| 

Houston canopy: CRS: EPSG:6344 
Size: 1542 1376 
Transform: | 50.01, 0.00, 237912.00| 
| 0.00,-50.01, 3334954.00| 
| 0.00, 0.00, 1.00|'''

# EPSG - same coordinate system
# Size - same number of columns and rows
# Transform - identical pixel size and origin
# Pixel-for-pixel alignment
# Same grid, resolution (~50m), spatial origin, and extent

print("\nScript finished.")