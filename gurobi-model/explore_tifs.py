import rasterio

tifs = [
    "data/ForUSTree_2018_HighVeg_TreeCoverage.tif",
    "data/Heat_Index_AF_2024.tif",
    "data/Heat_Index_AM_2024.tif",
    "data/Heat_Index_PM_2024.tif"
]

for tif in tifs:
    try:
        with rasterio.open(tif) as src:
            print(f"--- {tif.split('/')[-1]} ---")
            print(f"Shape: {src.shape}")
            print(f"CRS: {src.crs}")
            print(f"Bounds: {src.bounds}")
            print(f"Transform: {src.transform}")
            print(f"Nodata: {src.nodata}")
            print(f"Dtypes: {src.dtypes}")
            print()
    except Exception as e:
        print(f"Failed to open {tif}: {e}")
