package app.toiletsupport.trial;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// 気圧センサー（ブラウザでは読めないので、アプリ側で読んで Web に渡す）。
// Web 側は src/lib/barometer.ts。"pressure" で { hPa, t（ミリ秒） } を約5回/秒で送る
@CapacitorPlugin(name = "Barometer")
public class BarometerPlugin extends Plugin implements SensorEventListener {
    private SensorManager sensors;
    private Sensor pressure;
    private long lastSent = 0;

    @Override
    public void load() {
        sensors = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        pressure = sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_PRESSURE);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", pressure != null);
        if (pressure != null) r.put("name", pressure.getName());
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (pressure == null) {
            call.reject("この端末には気圧センサーがありません");
            return;
        }
        sensors.registerListener(this, pressure, SensorManager.SENSOR_DELAY_NORMAL);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (sensors != null) sensors.unregisterListener(this);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (sensors != null) sensors.unregisterListener(this);
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        long now = System.currentTimeMillis();
        if (now - lastSent < 200) return;
        lastSent = now;
        JSObject d = new JSObject();
        d.put("hPa", e.values[0]);
        d.put("t", now);
        notifyListeners("pressure", d);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
