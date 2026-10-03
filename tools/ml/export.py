# 把 CubiCasa5K 的預訓練權重轉成網頁用的 ONNX 模型（model/cubicasa-int8.onnx）。
# 用法（先照 tools/ml/README.md 準備好 CubiCasa5k 的程式碼與權重檔）：
#   python tools/ml/export.py CubiCasa5k資料夾 model_best_val_loss_var.pkl model/cubicasa-int8.onnx
import os, sys, tempfile
import torch
from onnxruntime.quantization import quantize_dynamic, QuantType

repo, weights, out = sys.argv[1:4]
sys.path.insert(0, repo)
from floortrans.models.hg_furukawa_original import hg_furukawa_original

# 和 CubiCasa5k 的 eval.py 相同：最後一層換成 44 個輸出（21 張牆角熱度圖、12 個房間類別、11 個圖示類別）
n = 44
m = hg_furukawa_original(n_classes=51)
m.conv4_ = torch.nn.Conv2d(256, n, bias=True, kernel_size=1)
m.upsample = torch.nn.ConvTranspose2d(n, n, kernel_size=4, stride=4)
# 權重檔是 pickle，只讀取張量（weights_only），不執行檔案裡的程式
ck = torch.load(weights, map_location='cpu', weights_only=True)
m.load_state_dict(ck['model_state'])
m.eval()

# 輸入：[1, 3, 高, 寬]，數值 2·RGB/255 − 1，高和寬是 64 的倍數
fp32 = os.path.join(tempfile.mkdtemp(), 'cubicasa.onnx')
torch.onnx.export(m, torch.randn(1, 3, 512, 512), fp32, input_names=['image'], output_names=['out'],
                  opset_version=17, dynamic_axes={'image': {2: 'h', 3: 'w'}, 'out': {2: 'h', 3: 'w'}}, dynamo=False)
# 權重量化成 8 位元：69 MB → 30 MB，房間類別和原版有 97% 的像素相同
quantize_dynamic(fp32, out, weight_type=QuantType.QUInt8)
print('%s：%.1f MB' % (out, os.path.getsize(out) / 1e6))
