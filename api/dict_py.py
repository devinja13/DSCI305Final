import pandas as pd

# load the CSV file
df = pd.read_csv("Estimated Coverage - Sheet1.csv")

# create dictionary
tree_dict = {}

for _, row in df.iterrows():
    name = row["Common_Name"]
    
    tree_dict[name] = {
        "Size_Gallon": row["Size_Gallon"],
        "Size_Classification": row["Size_Classification"],
        "Estimated_Diameter_m": row["Estimated_Diameter (meters)"],
        "Estimated_Canopy_m": row["Estimated_Canopy (meters)"],
        "Cost": row["Cost"]
    }
