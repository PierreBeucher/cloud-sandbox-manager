/**
 * Get all IP addresses in range. Inspired from https://stackoverflow.com/questions/22927298/create-ip-range-from-start-and-end-point-in-javascript-or-jquery
 * @param start HEX start range
 * @param end HEX range end
 * @returns 
 */
export function getIpAddressRange(start: number, end: number): string[] {
    
    let result : string[] = [] 

    for(var i = start; i < end; i++)
    {   
        var oc4 = (i>>24) & 0xff;
        var oc3 = (i>>16) & 0xff;
        var oc2 = (i>>8) & 0xff;
        var oc1 = i & 0xff;
        
        result.push(oc4 + "." + oc3 + "." + oc2 + "." + oc1);
        
    }
    return result
}