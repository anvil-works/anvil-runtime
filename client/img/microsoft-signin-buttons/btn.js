!function(){if(customElements.get("microsoft-signin-button"))return;let t=`
<style>
.ms-signin-button{
  background-color:#ffffff;
  border:1px solid #8c8c8c;
  border-radius:2px;
  color:#5e5e5e;
  cursor:pointer;
  font-family:'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif;
  font-size:15px;
  font-weight:600;
  height:41px;
  padding:0 12px;
  transition:background-color 0.15s;
  width:100%;
  max-width:400px;
}
.ms-signin-button:hover{
  background-color:#f8f8f8;
}
.ms-signin-button:active{
  background-color:#f0f0f0;
}
.ms-signin-button-wrapper{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  height:100%;
}
.ms-signin-button svg{
  width:21px;
  height:21px;
}
</style>
<button class="ms-signin-button" part="button">
  <div class="ms-signin-button-wrapper">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21">
      <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
      <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
    </svg>
    <span><slot>Sign in with Microsoft</slot></span>
  </div>
</button>`;class o extends HTMLElement{constructor(){super();let o=this.attachShadow({mode:"closed"});o.innerHTML=t}}customElements.define("microsoft-signin-button",o)}();
