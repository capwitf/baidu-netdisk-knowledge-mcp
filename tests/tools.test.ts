import { describe, expect, it } from "vitest";
import { registerBaiduTools } from "../src/tools.js";

describe("MCP tool registration", () => {
  it("registers focused Baidu Netdisk tools with stable names", () => {
    const names: string[] = [];
    registerBaiduTools({
      registerTool: (name) => {
        names.push(name);
      }
    });

    expect(names).toEqual([
      "baidu_auth_status",
      "baidu_auth_url",
      "baidu_auth_qrcode_url",
      "baidu_auth_qrcode",
      "baidu_auth_exchange_code",
      "baidu_auth_refresh",
      "baidu_operation_log",
      "baidu_quota",
      "baidu_list_files",
      "baidu_list_all_files",
      "baidu_search_files",
      "baidu_search_selectable_files",
      "baidu_list_selectable_files",
      "baidu_select_files",
      "baidu_file_metas",
      "baidu_create_folder",
      "baidu_rename_file",
      "baidu_copy_file",
      "baidu_move_file",
      "baidu_delete_file",
      "baidu_upload_file",
      "baidu_download_file",
      "baidu_read_selection",
      "baidu_analyze_selection",
      "baidu_list_skills",
      "baidu_run_skill",
      "baidu_plan_organize_selection"
    ]);
  });
});
