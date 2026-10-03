# AI 辨識模型

網頁的「AI 辨識」使用 `model/cubicasa-int8.onnx`，是 [CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k) 公開的預訓練模型轉成 ONNX 再壓縮的版本，在瀏覽器裡用 ONNX Runtime Web 執行。

重新產生模型檔：

1. 下載 CubiCasa5k 的程式碼：`git clone https://github.com/CubiCasa/CubiCasa5k`
   - `floortrans/models/__init__.py` 會載入用不到的 `model_1427`，造成循環引用，把那一行註解掉。
2. 從 CubiCasa5k README 裡的 Google Drive 連結下載權重檔 `model_best_val_loss_var.pkl`。
3. 安裝套件：`pip install torch onnx onnxruntime`
4. 執行：`python tools/ml/export.py CubiCasa5k model_best_val_loss_var.pkl model/cubicasa-int8.onnx`

模型與權重是 CubiCasa 以 CC BY-NC 4.0 授權公開，只能用在非商業用途，授權說明見 `docs/licenses/CubiCasa5k.txt`。
