import rasterio
from rasterio.warp import reproject, Resampling
import numpy as np
from sklearn.linear_model import LinearRegression
import matplotlib.pyplot as plt

# File paths
tree_files = {
    "Density": "data/ForUSTree_2018_HighVeg_Density_50m.tif",
    "Height": "data/ForUSTree_2018_HighVeg_Height.50m.tif"
}
heat_files = [
    "data/Heat_Index_AM_2024.tif",
    "data/Heat_Index_PM_2024.tif",
    "data/Heat_Index_AF_2024.tif"
]

def align_and_read_raster(src_file, target_profile):
    """
    Reads a source raster and reprojects it to match the target profile
    (CRS, transform, width, height).
    """
    with rasterio.open(src_file) as src:
        dest_array = np.zeros((target_profile['height'], target_profile['width']), dtype=np.float32)
        src_nodata = src.nodata if src.nodata is not None else -9999.0
        
        reproject(
            source=rasterio.band(src, 1),
            destination=dest_array,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=target_profile['transform'],
            dst_crs=target_profile['crs'],
            resampling=Resampling.average,
            dst_nodata=src_nodata
        )
        return dest_array, src_nodata

def main():
    print("Loading target Tree raster (defines 50m grid)...")
    with rasterio.open(tree_files["Density"]) as src:
        target_profile = src.profile

    # Reproject and align Heat Index rasters to the 50m target grid
    heat_arrays = []
    heat_nodata_val = None
    
    for h_idx, h_file in enumerate(heat_files):
        print(f"Aligning {h_file}...")
        aligned_data, nodata = align_and_read_raster(h_file, target_profile)
        heat_arrays.append(aligned_data)
        if h_idx == 0:
            heat_nodata_val = nodata

    print("Calculating average Heat Index...")
    stacked_heat = np.stack(heat_arrays, axis=0)
    valid_heat_mask = ~np.isclose(stacked_heat, heat_nodata_val)
    all_valid_heat_mask = valid_heat_mask.all(axis=0)

    mean_heat = np.zeros_like(heat_arrays[0])
    with np.errstate(invalid='ignore'):
         mean_heat[all_valid_heat_mask] = np.mean(stacked_heat[:, all_valid_heat_mask], axis=0)
    
    valid_heat_vals = mean_heat[all_valid_heat_mask]
    heat_min = valid_heat_vals.min()
    heat_max = valid_heat_vals.max()
    print(f"Original Mean Heat Index range: [{heat_min:.2f}, {heat_max:.2f}]")

    # Collect data for multiple regression
    # We need to make sure we use a single mask where BOTH density and height are valid
    tree_data_dict = {}
    valid_tree_masks = []
    
    # Process each tree variable
    for var_name, file_path in tree_files.items():
        print(f"\n--- Processing Tree {var_name} ---")
        with rasterio.open(file_path) as src:
            tree_data = src.read(1)
            tree_nodata = src.nodata

        if tree_nodata is not None:
            valid_tree_mask = (tree_data != tree_nodata)
        else:
            valid_tree_mask = (tree_data > 0) # Adjust if 0 means valid 0%

        tree_data_dict[var_name] = tree_data
        valid_tree_masks.append(valid_tree_mask)

        # Combined mask for this specific tree variable
        regression_mask = all_valid_heat_mask & valid_tree_mask
        
        # X: Tree variable, y: Heat Index
        X_tree = tree_data[regression_mask].reshape(-1, 1)
        # Using the raw averaged heat index instead of scaled
        y_heat = mean_heat[regression_mask]
        
        num_samples = len(y_heat)
        print(f"Found {num_samples} valid 50mx50m cells for regression out of {tree_data.size} total cells.")

        if num_samples == 0:
            print("Error: No overlapping valid cells found between datasets.")
            continue

        print(f"Performing Linear Regression: Mean Heat Index ~ Tree {var_name}")
        model = LinearRegression()
        model.fit(X_tree, y_heat)
        
        r_sq = model.score(X_tree, y_heat)
        coef = model.coef_[0]
        intercept = model.intercept_

        print(f"R-squared:    {r_sq:.4f}")
        print(f"Coefficient:  {coef:.4f}")
        print(f"Intercept:    {intercept:.4f}")

        print(f"Generating visualization for {var_name}...")
        plt.figure(figsize=(10, 6))
        
        sample_size = min(num_samples, 50000)
        if num_samples > sample_size:
            idx = np.random.choice(num_samples, sample_size, replace=False)
            plt.scatter(X_tree[idx], y_heat[idx], alpha=0.1, s=1, color='green', label=f'Data (sampled {sample_size})')
        else:
            plt.scatter(X_tree, y_heat, alpha=0.1, s=1, color='green', label='Data')
            
        x_line = np.linspace(X_tree.min(), X_tree.max(), 100).reshape(-1, 1)
        y_line = model.predict(x_line)
        plt.plot(x_line, y_line, color='red', linewidth=2, label=f"Fit: y = {coef:.4f}x + {intercept:.4f}")
        
        plt.title(f"Mean Heat Index vs. Tree Canopy {var_name} (50m Resolution)")
        plt.xlabel(f"Tree Canopy {var_name}")
        plt.ylabel("Mean Heat Index")
        plt.legend()
        plt.grid(True, alpha=0.3)
        
        out_plot = f"regression_{var_name.lower()}.png"
        plt.savefig(out_plot, dpi=300, bbox_inches='tight')
        plt.close()
        print(f"Saved plot to {out_plot}")

    print("\n--- Processing 3D Multiple Regression (Density + Height) ---")
    # Mask where Heat Index, Density, and Height are ALL valid
    combined_tree_mask = valid_tree_masks[0] & valid_tree_masks[1]
    multi_regression_mask = all_valid_heat_mask & combined_tree_mask

    y_multi = mean_heat[multi_regression_mask]
    density_multi = tree_data_dict["Density"][multi_regression_mask]
    height_multi = tree_data_dict["Height"][multi_regression_mask]
    
    # Feature matrix X needs shape (n_samples, 2)
    X_multi = np.column_stack((density_multi, height_multi))

    num_multi_samples = len(y_multi)
    print(f"Found {num_multi_samples} valid 50mx50m cells for 3D regression.")

    if num_multi_samples > 0:
        model_multi = LinearRegression()
        model_multi.fit(X_multi, y_multi)

        r_sq_multi = model_multi.score(X_multi, y_multi)
        coef_multi = model_multi.coef_
        intercept_multi = model_multi.intercept_

        print(f"R-squared:    {r_sq_multi:.4f}")
        print(f"Coefficients: Density={coef_multi[0]:.4f}, Height={coef_multi[1]:.4f}")
        print(f"Intercept:    {intercept_multi:.4f}")

        print("Generating 3D visualization...")
        fig = plt.figure(figsize=(10, 8))
        ax = fig.add_subplot(111, projection='3d')

        sample_size = min(num_multi_samples, 10000) # smaller sample for 3D rendering
        if num_multi_samples > sample_size:
            idx = np.random.choice(num_multi_samples, sample_size, replace=False)
            ax.scatter(density_multi[idx], height_multi[idx], y_multi[idx], alpha=0.1, s=2, color='green', label=f'Data (sampled {sample_size})')
        else:
            ax.scatter(density_multi, height_multi, y_multi, alpha=0.1, s=2, color='green', label='Data')

        # Create the plane grid
        d_range = np.linspace(density_multi.min(), density_multi.max(), 10)
        h_range = np.linspace(height_multi.min(), height_multi.max(), 10)
        D, H = np.meshgrid(d_range, h_range)
        
        # Calculate Z (predicted Heat Index) on the grid
        Z = intercept_multi + (coef_multi[0] * D) + (coef_multi[1] * H)
        
        ax.plot_surface(D, H, Z, alpha=0.3, color='red')

        ax.set_xlabel('Tree Density')
        ax.set_ylabel('Tree Height')
        ax.set_zlabel('Mean Heat Index')
        ax.set_title("3D Regression: Mean Heat Index ~ Density + Height")
        
        out_plot_3d = "regression_3d.png"
        plt.savefig(out_plot_3d, dpi=300, bbox_inches='tight')
        plt.close()
        print(f"Saved 3D plot to {out_plot_3d}")

if __name__ == "__main__":
    main()
