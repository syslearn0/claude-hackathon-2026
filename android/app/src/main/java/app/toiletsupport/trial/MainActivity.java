package app.toiletsupport.trial;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // アプリの中だけの機能（気圧センサー）
        registerPlugin(BarometerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
