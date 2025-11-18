{
  "targets": [
    {
      "target_name": "engine_addon",
      "sources": [
        "addon.cc",
        "../../native/engine.cpp",
        "../../native/nnue.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "../../native"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "cflags_cc": [ "-std=c++20" ],
      "conditions": [
        ["OS=='win'", { "msvs_settings": { "VCCLCompilerTool": { "AdditionalOptions": [ "/std:c++20" ] } } } ]
      ]
    }
  ]
}
